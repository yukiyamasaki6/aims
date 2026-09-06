import { useCallback, useRef, useState } from "react";

export type SyncStatus = "synced" | "syncing" | "error" | "pending";

export type SyncError = { key: string; label: string; message: string };

export type BatchResult = { error: string } | undefined;

export type EnqueueInput = {
  key: string;
  label: string;
  run: () => Promise<BatchResult>;
  // 別のkeyの操作が先に完了している必要がある場合に指定する
  // （例: まだ作成中の距離へのスコア記録は、その距離のdistance:{id}
  // キーの完了を待つ必要がある）。指定したkeyに何も走っていなければ
  // 待ち時間なしで即座に実行される。
  dependsOnKey?: string;
};

export type ShotUpsert = {
  distanceId: string;
  endNumber: number;
  arrowNumber: number;
  scoreStr: string;
  scoreInt: number;
};
export type ShotClear = {
  distanceId: string;
  endNumber: number;
  arrowNumber: number;
};

export type EnqueueShotInput = {
  key: string; // `shot:${distanceId}:${end}:${arrow}`
  label: string;
  dependsOnKey?: string; // 作成中のdistanceへのスコアの場合、`distance:{id}`
  upsert?: ShotUpsert;
  clear?: ShotClear;
};

type RunShotBatch = (batch: {
  upsert: ShotUpsert[];
  clear: ShotClear[];
}) => Promise<BatchResult>;

// サインイン切れはリトライしても解決しないため、リトライ対象からは除外し
// 即座に通常のエラーとして表示する（他の失敗と同様、errorMapに積むだけ）。
// アプリ全体でセッション切れを検知してサインイン画面へ誘導する仕組みは
// 別issue（#303）で扱う。
export const AUTH_REQUIRED_MESSAGE = "サインインが必要です。";

// 通信の一時的な不調（屋外での電波不安定等）から自動的に回復できるよう、
// 指数バックオフで有限回数リトライする。オンライン/オフラインイベントには
// 頼らない（電波はあるように見えて実際には届かない状況に強くするため、
// 実際の通信結果だけを根拠にする）。タブを閉じる・リロードした場合や、
// この回数を使い切った場合の永続化・無期限リトライは別issue（#263）で扱う。
export const RETRY_DELAYS_MS = [3000, 6000, 12000, 24000];

function toSafeResult(promise: Promise<BatchResult>): Promise<BatchResult> {
  // run()が例外を投げた場合（ネットワーク切断等の予期しない失敗）も
  // 永久にsyncingのまま止まらないよう、必ずcatchして通常の失敗と
  // 同じ扱いにする。
  return promise.catch((e) => ({
    error: e instanceof Error ? e.message : "予期しないエラーが発生しました。",
  }));
}

// 送信待ちの操作を2つの方式で扱う。
//
// 1. enqueue（ラウンド設定・距離の追加/更新/削除）: keyごとに独立した列。
//    異なるkeyの操作は互いを待たずに即座に実行され、同じkeyへの操作だけが
//    投入順を守って直列に実行される。これらは連打されるものではないため、
//    まとめて送る必要はない。
//
// 2. enqueueShot（スコアの記録・取り消し）: 高頻度に連打されるため、
//    個別送信では通信本数分の往復（Next.jsのServer Actionは並列に投げても
//    サーバー側で直列にしか処理されない）で同期完了までの体感速度が悪化する。
//    そのため、送信中でない時にちょうど溜まっている分をまとめて1回の
//    リクエストに含めて送る（同じマスへの連続上書きは最後の値だけを送る）。
//    送信中に新たに積まれた分は、今の送信が終わり次第すぐ次のまとまりとして送る。
//
// どちらもdependsOnKeyで、新規distance作成のように他の操作から参照されうる
// 操作の完了を必要な範囲だけ待たせられる。
// どちらも失敗時はRETRY_DELAYS_MSに従って自動リトライし、使い切ってから
// 初めてエラーとして表示する。リトライ待機中に同じ箇所への新しい操作が
// 積まれた場合は、古い値のリトライより新しい値を優先する。
export function useSyncQueue() {
  const [errorMap, setErrorMap] = useState<Map<string, SyncError>>(new Map());
  const [pendingCount, setPendingCount] = useState(0);
  const [shotPendingKeys, setShotPendingKeys] = useState<Set<string>>(
    new Set(),
  );
  const [retryingKeys, setRetryingKeys] = useState<Set<string>>(new Set());
  const [shotRetrying, setShotRetrying] = useState(false);
  const tailsRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const shotBatchRef = useRef<Map<string, EnqueueShotInput>>(new Map());
  const shotFlightRef = useRef(false);
  // タイマーだけでなく、それに紐づくPromiseのresolveも保持する。clearTimeout
  // だけでは待機中のattempt()が返したPromiseが永遠に解決されないままになり、
  // 同じkeyへの次のenqueueがtailsRefの古いPromiseを待ち続けて固まってしまう
  // ため、キャンセル時は必ずresolveも呼ぶ。
  const retryTimersRef = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; resolve: () => void }>
  >(new Map());

  const settleKeys = useCallback(
    (items: { key: string; label: string }[], result: BatchResult) => {
      setErrorMap((prev) => {
        const copy = new Map(prev);
        for (const item of items) {
          if (result?.error) {
            copy.set(item.key, {
              key: item.key,
              label: item.label,
              message: result.error,
            });
          } else {
            copy.delete(item.key);
          }
        }
        return copy;
      });
    },
    [],
  );

  const clearRetryTimer = useCallback((key: string) => {
    const scheduled = retryTimersRef.current.get(key);
    if (scheduled) {
      clearTimeout(scheduled.timer);
      retryTimersRef.current.delete(key);
      // 待機中だったattempt()のPromiseを解決し、tailsRefに残る古いPromiseが
      // 永遠にpendingのまま次のenqueueを塞き止めないようにする。この経路は
      // attempt()内の最終settle（pendingCountのdecrement）を経由しないため、
      // ここで代わりに減らす（打ち切られた試行はもう完了しないため）。
      scheduled.resolve();
      setPendingCount((n) => n - 1);
    }
    setRetryingKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const enqueue = useCallback(
    (input: EnqueueInput) => {
      // 新しい楽観値が古い失敗・待機中のリトライを上書きするため、同じkeyへの
      // 再送信は直前の失敗表示・予約済みリトライを即座に打ち切る。
      clearRetryTimer(input.key);
      setErrorMap((prev) => {
        if (!prev.has(input.key)) return prev;
        const copy = new Map(prev);
        copy.delete(input.key);
        return copy;
      });
      setPendingCount((n) => n + 1);

      const ownTail = tailsRef.current.get(input.key) ?? Promise.resolve();
      const depTail = input.dependsOnKey
        ? (tailsRef.current.get(input.dependsOnKey) ?? Promise.resolve())
        : Promise.resolve();

      const attempt = (attemptIndex: number): Promise<void> =>
        toSafeResult(input.run()).then((result) => {
          if (
            result?.error &&
            result.error !== AUTH_REQUIRED_MESSAGE &&
            attemptIndex < RETRY_DELAYS_MS.length
          ) {
            setRetryingKeys((prev) => new Set(prev).add(input.key));
            return new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                retryTimersRef.current.delete(input.key);
                setRetryingKeys((prev) => {
                  const next = new Set(prev);
                  next.delete(input.key);
                  return next;
                });
                attempt(attemptIndex + 1).then(resolve);
              }, RETRY_DELAYS_MS[attemptIndex]);
              retryTimersRef.current.set(input.key, { timer, resolve });
            });
          }
          settleKeys([input], result);
          setPendingCount((n) => n - 1);
        });

      const runPromise = Promise.all([ownTail, depTail]).then(() => attempt(0));
      tailsRef.current.set(input.key, runPromise);
    },
    [settleKeys, clearRetryTimer],
  );

  const flushShots = useCallback(
    (runBatch: RunShotBatch) => {
      if (shotFlightRef.current) return;
      if (shotBatchRef.current.size === 0) return;

      shotFlightRef.current = true;
      const items = Array.from(shotBatchRef.current.values());
      shotBatchRef.current = new Map();

      const finishFlight = () => {
        shotFlightRef.current = false;
        flushShots(runBatch);
      };

      const attempt = (pending: EnqueueShotInput[], attemptIndex: number) => {
        // リトライ実行時点で既に新しい値が積まれているkeyは、古い値を送らず
        // 除外する（新しい入力が待機中のリトライより優先される）。
        const itemsToRetry = pending.filter(
          (item) => !shotBatchRef.current.has(item.key),
        );
        if (itemsToRetry.length === 0) {
          finishFlight();
          return;
        }

        const upsert = itemsToRetry
          .map((i) => i.upsert)
          .filter((s): s is ShotUpsert => s !== undefined);
        const clear = itemsToRetry
          .map((i) => i.clear)
          .filter((s): s is ShotClear => s !== undefined);

        toSafeResult(runBatch({ upsert, clear })).then((result) => {
          if (
            result?.error &&
            result.error !== AUTH_REQUIRED_MESSAGE &&
            attemptIndex < RETRY_DELAYS_MS.length
          ) {
            // このタイマー自体は誰にも参照されない。同じマスへの新しい入力に
            // よるキャンセルは、発火時にitemsToRetryをshotBatchRefと照合する
            // filterで行う（バッチ全体を打ち切る必要は無いため）。
            setShotRetrying(true);
            setTimeout(() => {
              setShotRetrying(false);
              attempt(itemsToRetry, attemptIndex + 1);
            }, RETRY_DELAYS_MS[attemptIndex]);
            return;
          }
          settleKeys(itemsToRetry, result);
          setShotPendingKeys((prev) => {
            const next = new Set(prev);
            for (const item of itemsToRetry) next.delete(item.key);
            return next;
          });
          finishFlight();
        });
      };

      attempt(items, 0);
    },
    [settleKeys],
  );

  const enqueueShot = useCallback(
    (input: EnqueueShotInput, runBatch: RunShotBatch) => {
      setErrorMap((prev) => {
        if (!prev.has(input.key)) return prev;
        const copy = new Map(prev);
        copy.delete(input.key);
        return copy;
      });
      setShotPendingKeys((prev) => new Set(prev).add(input.key));

      const depTail = input.dependsOnKey
        ? (tailsRef.current.get(input.dependsOnKey) ?? Promise.resolve())
        : Promise.resolve();

      depTail.then(() => {
        // 同じマスへの連続上書きは、送信済みでなければ最後の値だけが残る。
        shotBatchRef.current.set(input.key, input);
        flushShots(runBatch);
      });
    },
    [flushShots],
  );

  const errorFor = useCallback(
    (key: string) => errorMap.get(key)?.message,
    [errorMap],
  );

  const status: SyncStatus =
    retryingKeys.size > 0 || shotRetrying
      ? "pending"
      : pendingCount > 0 || shotPendingKeys.size > 0
        ? "syncing"
        : errorMap.size > 0
          ? "error"
          : "synced";

  return {
    status,
    errors: Array.from(errorMap.values()),
    errorFor,
    enqueue,
    enqueueShot,
  };
}
