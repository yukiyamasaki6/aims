import { useCallback, useEffect, useRef, useState } from "react";
import {
  eventIdOf,
  executeSyncOperation,
  type SyncOperation,
} from "./sync-events";
import {
  loadPendingOperations,
  removePendingOperation,
  savePendingOperation,
} from "./sync-outbox";
import { syncShots } from "./sync-shots";

export type SyncStatus = "synced" | "syncing" | "error" | "pending";

export type SyncError = { key: string; label: string; message: string };

export type BatchResult = { error: string; permanent?: boolean } | undefined;

export type EnqueueInput = {
  key: string;
  label: string;
  run?: () => Promise<BatchResult>;
  // 別のkeyの操作が先に完了している必要がある場合に指定する
  // （例: まだ作成中の距離へのスコア記録は、その距離のdistance:{id}
  // キーの完了を待つ必要がある）。指定したkeyに何も走っていなければ
  // 待ち時間なしで即座に実行される。
  dependsOnKey?: string;
  operation?: SyncOperation;
  restored?: boolean;
};

export type ShotUpsert = {
  shotEventId: string;
  shooterId?: string;
  distanceId: string;
  endNumber: number;
  arrowNumber: number;
  scoreStr: string;
  scoreInt: number;
};
export type ShotClear = {
  shotEventId: string;
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
  operation?: SyncOperation;
  restored?: boolean;
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
// この回数を使い切った場合の永続化・無期限リトライはこのoutboxで扱う。
export const RETRY_DELAYS_MS = [3000, 6000, 12000, 24000];

function toSafeResult(promise: Promise<BatchResult>): Promise<BatchResult> {
  // run()が例外を投げた場合（ネットワーク切断等の予期しない失敗）も
  // 永久にsyncingのまま止まらないよう、必ずcatchして通常の失敗と
  // 同じ扱いにする。
  return promise.catch((e) => ({
    error: e instanceof Error ? e.message : "予期しないエラーが発生しました。",
  }));
}

function shotKeyBelongsToDistance(shotKey: string, distanceId: string) {
  return shotKey.startsWith(`shot:${distanceId}:`);
}

// 送信待ちの操作を2つの方式で扱う。
//
// 1. enqueue（ラウンド設定・距離の追加/更新/削除）: そのラウンド全体で
//    共有する1本の直列tailに乗せる。ラウンド設定の更新も、そのラウンドに
//    属する全distanceの作成・更新・削除も、keyに関わらず投入順を守って
//    直列に実行される。これはサーバー側のcreate_round/update_round/
//    create_distance/update_distanceが、いずれも対象roundの行をfor update
//    でロックしてから処理する、という直列化粒度に合わせたもの。
//    同じkeyへの新しい操作が積まれても、古い操作の待機（リトライ待機等）を
//    打ち切ることは無い（打ち切ると、例えばまだリトライ中のdistance作成を
//    直後の同じkeyへの更新が追い越して先に完了してしまい、サーバー上は
//    まだ存在しない距離への更新として失敗する、といった不整合を招くため。
//    event_id起点の冪等性とサーバー側のrevision採番があるため、全操作を
//    打ち切らず順番通り送っても結果の正しさは保たれる）。
//    距離の設定（的・エンド数・矢数等）を変更する更新は、送信を始める前に
//    同じ距離の未送信・進行中のショットバッチ（後述のenqueueShot）が
//    片付くのを待つ。ショットが残っている距離は構成を変更できないという
//    サーバー側の制約に、送信順序を合わせるため。
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
// 初めてエラーとして表示する。
function isPermanentFailure(result: BatchResult): boolean {
  return result?.permanent === true;
}

export function useSyncQueue(
  roundId?: string,
  onPermanentFailure?: () => void,
) {
  const [errorMap, setErrorMap] = useState<Map<string, SyncError>>(new Map());
  const [pendingCount, setPendingCount] = useState(0);
  const [persistingCount, setPersistingCount] = useState(0);
  const [shotPendingKeys, setShotPendingKeys] = useState<Set<string>>(
    new Set(),
  );
  const [retryingKeys, setRetryingKeys] = useState<Set<string>>(new Set());
  const [shotRetrying, setShotRetrying] = useState(false);
  // ラウンド設定・distance操作（enqueue経由）が全て乗る、ラウンド単位で
  // 共有する1本の直列tail。useSyncQueue自体がラウンドごとに1つ生成される
  // ため、ここでroundIdごとにMap管理する必要はない。
  const roundTailRef = useRef<Promise<unknown>>(Promise.resolve());
  // key単位のtail（現状はdependsOnKey解決専用）。enqueueShotがdistance:{id}
  // の完了を待つ際に参照する。
  const tailsRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const shotBatchRef = useRef<Map<string, EnqueueShotInput>>(new Map());
  const shotFlightRef = useRef(false);
  // shotPendingKeys（React state）と同じ内容を同期的に参照するための複製。
  // 距離の設定変更が「その距離のショットバッチが空になるまで待つ」ことを
  // 判定・実現するには、setState経由では読めない最新値を同期的に参照できる
  // 必要があるため、更新のたびにこちらにも反映する。
  const shotPendingKeysRef = useRef<Set<string>>(new Set());
  // キーごとに「今そのマスに紐づいている最新のショット入力」を保持する。
  // 送信中に同じキーへ新しい値（例: 記録→クリア）が積まれた場合、送信中
  // だった古い値が完了しても、それはもう「そのキーの最新の状態」ではない
  // ため、pending解除・waiter通知の対象にしない（P2: 順序違反防止）。
  const latestShotInputRef = useRef<Map<string, EnqueueShotInput>>(new Map());
  // distanceIdごとに、その距離のショットの決着を待っているwaiter群。各
  // waiterは「enqueue時点でその距離に紐づいていた未決着の具体的な操作
  // （キーではなくEnqueueShotInputオブジェクトそのもの）の集合」を
  // 自分専用にスナップショットとして持ち、それらが1件ずつ解決するたびに
  // 減っていく。enqueue後に新たに積まれたショット（例: 別マスへの新しい
  // 記録）はこの集合に含まれないため、待つ対象が後から増えることはない
  // （P1: 循環待機によるデッドロック防止。distance更新はenqueue時点で
  // 既に存在したショットの決着だけを待ち、後から来たショット自身は
  // dependsOnKeyでそのdistance更新の完了を待つ設計のため、含めてしまうと
  // 互いを待ち合う循環になる）。
  //
  // キーではなく操作オブジェクトを対象にしているのは、スナップショット後に
  // その操作が「実際に送信されないまま、さらに新しい操作に上書きされる」
  // ケースがあるため（P1とP2の組み合わせで発生するデッドロック対策）。
  // 例: クリアが送信中にdistance更新がenqueueされ、その直後に同じマスへ
  // 新しい記録が積まれてクリアを上書きした場合、クリア自身は実際に完了する
  // ものの、その時点で「もう最新ではない」ため通常のpending解除（P2）は
  // 発生しない。一方、新しい記録はdependsOnKeyでこのdistance更新の完了を
  // 待っており、distance更新はクリアの決着（＝スナップショットに含まれる
  // 操作の解決）を待っているので、「クリアの解決」を"最新かどうかに関係なく"
  // 通知しないと、互いを待ち合う循環になる。そのため、スナップショットに
  // 含まれる操作は、(a)実際に送信されて決着した、(b)一度も送信されないまま
  // 別の操作に上書きされた、のいずれかが起きた時点で無条件に「解決済み」
  // として扱う（上書きした側は自分自身のdependsOnKeyで別途待つため、ここで
  // 二重に待つ必要はない）。
  const shotDistanceWaitersRef = useRef<
    Map<string, { items: Set<EnqueueShotInput>; resolve: () => void }[]>
  >(new Map());
  const restoredRef = useRef(false);
  const persistenceRef = useRef<Set<Promise<void>>>(new Set());

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

  // 指定した操作（1件のショット入力）が「解決済み」になったことを、その
  // 操作を待っているwaiterに通知する。「解決済み」は、実際に送信されて
  // 決着した場合と、一度も送信されないまま別の操作に上書きされた場合の
  // 両方を含む（shotDistanceWaitersRefのコメント参照）。各waiterは自分の
  // スナップショットからこの操作を取り除き、空になったwaiterだけを解決する。
  const notifyShotItemResolved = useCallback(
    (distanceId: string, item: EnqueueShotInput) => {
      const waiters = shotDistanceWaitersRef.current.get(distanceId);
      if (!waiters || waiters.length === 0) return;
      const remaining: typeof waiters = [];
      for (const waiter of waiters) {
        waiter.items.delete(item);
        if (waiter.items.size === 0) {
          waiter.resolve();
        } else {
          remaining.push(waiter);
        }
      }
      if (remaining.length > 0) {
        shotDistanceWaitersRef.current.set(distanceId, remaining);
      } else {
        shotDistanceWaitersRef.current.delete(distanceId);
      }
    },
    [],
  );

  // 指定した距離に紐づく、未送信・進行中のショットバッチが片付くまで待つ。
  // 呼び出し時点でその距離に紐づいていたキーそれぞれの「今のところ最新」の
  // 操作オブジェクトだけをスナップショットとして待つ（呼び出し後に新規
  // 追加されたキー・操作は待たない。理由はshotDistanceWaitersRefのコメント
  // を参照）。何も残っていなければ待ち時間なしで即座に解決する。
  const waitForShotBatch = useCallback((distanceId: string): Promise<void> => {
    const items = new Set<EnqueueShotInput>();
    for (const key of shotPendingKeysRef.current) {
      if (!shotKeyBelongsToDistance(key, distanceId)) continue;
      const latest = latestShotInputRef.current.get(key);
      if (latest) items.add(latest);
    }
    if (items.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = shotDistanceWaitersRef.current.get(distanceId) ?? [];
      waiters.push({ items, resolve });
      shotDistanceWaitersRef.current.set(distanceId, waiters);
    });
  }, []);

  const schedule = useCallback(
    (input: EnqueueInput) => {
      // 新しい楽観値の表示を優先するため、直前の失敗表示だけは上書きする
      // （実行中・待機中の古い操作自体を打ち切るわけではない。ラウンド・
      // 距離の操作は同じ共有tailに乗るため、古い操作は打ち切られず
      // 投入順のまま実行される）。
      setErrorMap((prev) => {
        if (!prev.has(input.key)) return prev;
        const copy = new Map(prev);
        copy.delete(input.key);
        return copy;
      });
      setPendingCount((n) => n + 1);

      const ownTail = roundTailRef.current;
      const depTail = input.dependsOnKey
        ? (tailsRef.current.get(input.dependsOnKey) ?? Promise.resolve())
        : Promise.resolve();
      // 距離の設定変更（distance.updated）は、既に得点が記録されている
      // 距離の構成列（的・エンド数・矢数）を変更できないというサーバー側の
      // 制約があるため、送信前にその距離の未送信ショットバッチが片付くのを
      // 待つ（例: オフライン中の「ショットを全クリア→距離の構成変更」の
      // 順序を、送信順でも保つ）。
      const shotWaitTail =
        input.operation?.type === "distance.updated"
          ? waitForShotBatch(input.operation.distanceId)
          : Promise.resolve();

      const attempt = (attemptIndex: number): Promise<void> =>
        toSafeResult(
          input.operation
            ? executeSyncOperation(input.operation)
            : (input.run?.() ??
                Promise.resolve({ error: "同期する操作が見つかりません。" })),
        ).then((result) => {
          if (
            result?.error &&
            result.error !== AUTH_REQUIRED_MESSAGE &&
            !isPermanentFailure(result) &&
            (input.operation || attemptIndex < RETRY_DELAYS_MS.length)
          ) {
            setRetryingKeys((prev) => new Set(prev).add(input.key));
            return new Promise<void>((resolve) => {
              setTimeout(
                () => {
                  setRetryingKeys((prev) => {
                    const next = new Set(prev);
                    next.delete(input.key);
                    return next;
                  });
                  attempt(attemptIndex + 1).then(resolve);
                },
                RETRY_DELAYS_MS[
                  Math.min(attemptIndex, RETRY_DELAYS_MS.length - 1)
                ],
              );
            });
          }
          settleKeys([input], result);
          if (
            (!result?.error || isPermanentFailure(result)) &&
            input.operation
          ) {
            void removePendingOperation(eventIdOf(input.operation));
          }
          if (
            isPermanentFailure(result) &&
            result?.error !== AUTH_REQUIRED_MESSAGE
          ) {
            onPermanentFailure?.();
          }
          setPendingCount((n) => n - 1);
        });

      const runPromise = Promise.all([ownTail, depTail, shotWaitTail]).then(
        () => attempt(0),
      );
      roundTailRef.current = runPromise;
      tailsRef.current.set(input.key, runPromise);
    },
    [settleKeys, onPermanentFailure, waitForShotBatch],
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
        // 除外された（＝一度も送信されないまま新しい値に上書きされた）操作
        // は、それ自体が送られることは二度と無いが、distance更新の
        // waiterがこの操作の決着を待っている可能性があるため、「解決済み」
        // として通知する（notifyShotItemResolvedのコメント参照）。
        const supersededWhileRetrying = pending.filter((item) =>
          shotBatchRef.current.has(item.key),
        );
        for (const item of supersededWhileRetrying) {
          const distanceId = item.upsert?.distanceId ?? item.clear?.distanceId;
          if (distanceId) notifyShotItemResolved(distanceId, item);
        }
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
            !isPermanentFailure(result) &&
            (itemsToRetry.some((item) => item.operation) ||
              attemptIndex < RETRY_DELAYS_MS.length)
          ) {
            // このタイマー自体は誰にも参照されない。同じマスへの新しい入力に
            // よるキャンセルは、発火時にitemsToRetryをshotBatchRefと照合する
            // filterで行う（バッチ全体を打ち切る必要は無いため）。
            setShotRetrying(true);
            setTimeout(
              () => {
                setShotRetrying(false);
                attempt(itemsToRetry, attemptIndex + 1);
              },
              RETRY_DELAYS_MS[
                Math.min(attemptIndex, RETRY_DELAYS_MS.length - 1)
              ],
            );
            return;
          }
          settleKeys(itemsToRetry, result);
          if (!result?.error || isPermanentFailure(result)) {
            for (const item of itemsToRetry) {
              if (item.operation) {
                void removePendingOperation(eventIdOf(item.operation));
              }
            }
          }
          if (
            isPermanentFailure(result) &&
            result?.error !== AUTH_REQUIRED_MESSAGE
          ) {
            onPermanentFailure?.();
          }
          // setStateのupdaterコールバックの実行タイミングに依存すると、直後の
          // shotPendingKeysRef.currentの参照がまだ古い値のままになる
          // 可能性がある（Reactはupdaterの同期実行を保証しない）。そのため
          // 次の値を先に同期的に計算し、refへの反映とsetStateへの反映を
          // 両方ここで済ませる。
          const nextShotPendingKeys = new Set(shotPendingKeysRef.current);
          for (const item of itemsToRetry) {
            // 送信中（今回のtoSafeResult(runBatch(...))待ち）に、同じキーへ
            // さらに新しい値（例: 記録が送信中の間にクリアがenqueueされる）
            // が積まれていた場合、今回決着したのは「そのキーの当時の値」で
            // あって「そのキーの最新の値」ではない。最新の値はまだ一度も
            // 送信されていないので、shotPendingKeys（UI表示・今後のスナップ
            // ショット用）上ではまだpendingのままにしておく（そうしないと、
            // この後にenqueueされる別のdistance更新のスナップショットが、
            // まだ送っていない最新の値を見落としてしまう＝P2バグになる）。
            if (latestShotInputRef.current.get(item.key) !== item) continue;
            nextShotPendingKeys.delete(item.key);
            latestShotInputRef.current.delete(item.key);
          }
          shotPendingKeysRef.current = nextShotPendingKeys;
          setShotPendingKeys(nextShotPendingKeys);
          // このバッチで実際に送信され決着した操作は、既にsettleした事実に
          // 変わりはないため、それが「最新」だったかどうかに関わらず
          // waiterへ「解決済み」を通知する（notifyShotItemResolvedの
          // コメント参照。ここをisLatestで絞ってしまうと、上書きされた側が
          // 決着してもwaiterに通知されず、上書きした側はdependsOnKey経由で
          // このdistance更新自身の完了を待っているため、互いを待ち合う
          // 循環＝P1+P2複合バグになる）。
          for (const item of itemsToRetry) {
            const distanceId =
              item.upsert?.distanceId ?? item.clear?.distanceId;
            if (distanceId) notifyShotItemResolved(distanceId, item);
          }
          finishFlight();
        });
      };

      attempt(items, 0);
    },
    [settleKeys, onPermanentFailure, notifyShotItemResolved],
  );

  const scheduleShot = useCallback(
    (input: EnqueueShotInput, runBatch: RunShotBatch) => {
      setErrorMap((prev) => {
        if (!prev.has(input.key)) return prev;
        const copy = new Map(prev);
        copy.delete(input.key);
        return copy;
      });
      // このキーの「今のところ最新」の入力として記録する。送信中に
      // これより新しい入力が来ればここが上書きされ、送信中だった古い方は
      // 決着してもpendingを解除しない（latestShotInputRefのコメント参照）。
      latestShotInputRef.current.set(input.key, input);
      // shotPendingKeysRefを常にsetState呼び出しと同期して更新する
      // （flushShots側の完了処理と同じ理由。updaterコールバックの実行
      // タイミングに依存しない）。
      const nextShotPendingKeys = new Set(shotPendingKeysRef.current).add(
        input.key,
      );
      shotPendingKeysRef.current = nextShotPendingKeys;
      setShotPendingKeys(nextShotPendingKeys);

      const depTail = input.dependsOnKey
        ? (tailsRef.current.get(input.dependsOnKey) ?? Promise.resolve())
        : Promise.resolve();

      depTail.then(() => {
        // 同じマスへの連続上書きは、送信済みでなければ最後の値だけが残る。
        const previous = shotBatchRef.current.get(input.key);
        if (previous) {
          if (previous.operation) {
            // 同じマスへの未送信の古い値は最終状態に不要なため、永続outbox
            // からも取り除く。これにより再読み込み後に古い入力が再生
            // されない。
            void removePendingOperation(eventIdOf(previous.operation));
          }
          // 一度も送信されないまま新しい値に上書きされた。この操作自体は
          // もう送られないが、distance更新のwaiterがこの操作の決着を
          // 待っている可能性があるため、「解決済み」として通知する
          // （notifyShotItemResolvedのコメント参照）。
          const distanceId =
            previous.upsert?.distanceId ?? previous.clear?.distanceId;
          if (distanceId) notifyShotItemResolved(distanceId, previous);
        }
        shotBatchRef.current.set(input.key, input);
        flushShots(runBatch);
      });
    },
    [flushShots, notifyShotItemResolved],
  );

  const enqueue = useCallback(
    (input: EnqueueInput) => {
      if (!input.operation || !roundId || input.restored) {
        schedule(input);
        return;
      }
      setPersistingCount((count) => count + 1);
      const persistence = savePendingOperation({
        eventId: eventIdOf(input.operation),
        roundId,
        key: input.key,
        dependsOnKey: input.dependsOnKey,
        label: input.label,
        operation: input.operation,
      })
        .then(() => schedule(input))
        .finally(() => {
          persistenceRef.current.delete(persistence);
          setPersistingCount((count) => count - 1);
        });
      persistenceRef.current.add(persistence);
    },
    [roundId, schedule],
  );

  const enqueueShot = useCallback(
    (input: EnqueueShotInput, runBatch: RunShotBatch) => {
      if (!input.operation || !roundId || input.restored) {
        scheduleShot(input, runBatch);
        return;
      }
      setPersistingCount((count) => count + 1);
      const persistence = savePendingOperation({
        eventId: eventIdOf(input.operation),
        roundId,
        key: input.key,
        dependsOnKey: input.dependsOnKey,
        label: input.label,
        operation: input.operation,
      })
        .then(() => scheduleShot(input, runBatch))
        .finally(() => {
          persistenceRef.current.delete(persistence);
          setPersistingCount((count) => count - 1);
        });
      persistenceRef.current.add(persistence);
    },
    [roundId, scheduleShot],
  );

  useEffect(() => {
    if (!roundId || restoredRef.current) return;
    restoredRef.current = true;
    void loadPendingOperations(roundId).then((operations) => {
      const remaining = [...operations];
      while (remaining.length > 0) {
        const index = remaining.findIndex(
          (pending) =>
            !pending.dependsOnKey ||
            !remaining.some((other) => other.key === pending.dependsOnKey),
        );
        const pending = remaining.splice(index === -1 ? 0 : index, 1)[0];
        if (!pending) continue;
        const shotInput: EnqueueShotInput | undefined =
          pending.operation.type === "shot.recorded"
            ? {
                key: pending.key,
                label: pending.label,
                dependsOnKey: pending.dependsOnKey,
                operation: pending.operation,
                restored: true,
                upsert: {
                  shotEventId: pending.operation.eventId,
                  distanceId: pending.operation.distanceId,
                  endNumber: pending.operation.endNumber,
                  arrowNumber: pending.operation.arrowNumber,
                  shooterId: pending.operation.shooterId,
                  scoreStr: pending.operation.scoreStr,
                  scoreInt: pending.operation.scoreInt,
                },
              }
            : pending.operation.type === "shot.cleared"
              ? {
                  key: pending.key,
                  label: pending.label,
                  dependsOnKey: pending.dependsOnKey,
                  operation: pending.operation,
                  restored: true,
                  clear: {
                    shotEventId: pending.operation.eventId,
                    distanceId: pending.operation.distanceId,
                    endNumber: pending.operation.endNumber,
                    arrowNumber: pending.operation.arrowNumber,
                  },
                }
              : undefined;
        if (shotInput) {
          scheduleShot(shotInput, syncShots);
          continue;
        }
        schedule({
          key: pending.key,
          label: pending.label,
          dependsOnKey: pending.dependsOnKey,
          operation: pending.operation,
          restored: true,
          run: () => executeSyncOperation(pending.operation),
        });
      }
    });
  }, [roundId, schedule, scheduleShot]);

  const errorFor = useCallback(
    (key: string) => errorMap.get(key)?.message,
    [errorMap],
  );

  const status: SyncStatus =
    retryingKeys.size > 0 || shotRetrying
      ? "pending"
      : persistingCount > 0 || pendingCount > 0 || shotPendingKeys.size > 0
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
