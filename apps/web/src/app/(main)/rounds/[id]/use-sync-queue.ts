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

// サインイン切れは「特定の操作が失敗した」のではなくセッション自体が
// 無効という別種の状態で、以降の全操作が同じ理由で失敗し続けるだけなので、
// 個別のエラーとして溜めずに検出したら即座にサインイン画面へ誘導する。
export const AUTH_REQUIRED_MESSAGE = "サインインが必要です。";

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
// 自動リトライ・永続化は将来の別issueで追加する前提で、ここでは1回のみ試行する。
export function useSyncQueue(options?: { onAuthRequired?: () => void }) {
  const [errorMap, setErrorMap] = useState<Map<string, SyncError>>(new Map());
  const [pendingCount, setPendingCount] = useState(0);
  const [shotPendingKeys, setShotPendingKeys] = useState<Set<string>>(
    new Set(),
  );
  const tailsRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const shotBatchRef = useRef<Map<string, EnqueueShotInput>>(new Map());
  const shotFlightRef = useRef(false);
  const onAuthRequired = options?.onAuthRequired;

  const settleKeys = useCallback(
    (items: { key: string; label: string }[], result: BatchResult) => {
      if (result?.error === AUTH_REQUIRED_MESSAGE) {
        onAuthRequired?.();
        return;
      }
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
    [onAuthRequired],
  );

  const enqueue = useCallback(
    (input: EnqueueInput) => {
      // 新しい楽観値が古い失敗を上書きするため、同じkeyへの再送信は
      // 直前の失敗表示を即座にクリアする（この試行の結果を待たない）。
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

      const runPromise = Promise.all([ownTail, depTail]).then(() =>
        toSafeResult(input.run()),
      );
      tailsRef.current.set(input.key, runPromise);

      runPromise.then((result) => {
        settleKeys([input], result);
        setPendingCount((n) => n - 1);
      });
    },
    [settleKeys],
  );

  const flushShots = useCallback(
    (runBatch: RunShotBatch) => {
      if (shotFlightRef.current) return;
      if (shotBatchRef.current.size === 0) return;

      shotFlightRef.current = true;
      const items = Array.from(shotBatchRef.current.values());
      shotBatchRef.current = new Map();

      const upsert = items
        .map((i) => i.upsert)
        .filter((s): s is ShotUpsert => s !== undefined);
      const clear = items
        .map((i) => i.clear)
        .filter((s): s is ShotClear => s !== undefined);

      toSafeResult(runBatch({ upsert, clear })).then((result) => {
        settleKeys(items, result);
        setShotPendingKeys((prev) => {
          const next = new Set(prev);
          for (const item of items) next.delete(item.key);
          return next;
        });
        shotFlightRef.current = false;
        flushShots(runBatch);
      });
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
    pendingCount > 0 || shotPendingKeys.size > 0
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
