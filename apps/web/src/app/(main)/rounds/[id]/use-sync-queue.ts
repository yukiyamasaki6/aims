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

function distanceIdOf(input: EnqueueShotInput): string | undefined {
  return input.upsert?.distanceId ?? input.clear?.distanceId;
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
//    送信中に新たに積まれた分は、今の送信が終わり次第すぐ次のまとまりとして
//    送る。このバッチ・直列化は距離単位（distanceId）で独立している
//    （サーバー側のrecord_shots/clear_shotsが対象distanceの行だけをfor
//    updateでロックし、round行はロックしない、という粒度に合わせたもの）。
//    距離自身の設定変更（1.のenqueue）は、この距離単位のtail
//    （shotTailByDistanceRef）が空になるのを待つことで、「その距離の
//    未送信ショットが片付くまで待つ」を実現している。距離ごとの
//    バッチ・tailを素直に共有しているだけなので、1.のround単位のtailと
//    同じ「投入順を守って直列に実行する」という単純な仕組みの繰り返しであり、
//    個別の待ち合わせ・通知ロジックを別途持たない。
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
  // 距離ごとに独立してリトライ待機し得るため、単一のbooleanではなく
  // 「今リトライ待機中の距離id」の集合で持つ（他の距離のリトライ完了で
  // 誤って解除されないように）。
  const [shotRetryingDistances, setShotRetryingDistances] = useState<
    Set<string>
  >(new Set());
  // ラウンド設定・distance操作（enqueue経由）が全て乗る、ラウンド単位で
  // 共有する1本の直列tail。useSyncQueue自体がラウンドごとに1つ生成される
  // ため、ここでroundIdごとにMap管理する必要はない。
  const roundTailRef = useRef<Promise<unknown>>(Promise.resolve());
  // key単位のtail（現状はdependsOnKey解決専用）。enqueueShotがdistance:{id}
  // の完了を待つ際に参照する。
  const tailsRef = useRef<Map<string, Promise<unknown>>>(new Map());
  // 距離ごとに独立したショットの未送信バッチ・送信中フラグ・直列tail。
  // distanceIdをキーとするMapで、距離間は完全に独立して並行動作する
  // （サーバーが距離ごとの行ロックしか取らないのと同じ粒度）。
  const shotBatchByDistanceRef = useRef<
    Map<string, Map<string, EnqueueShotInput>>
  >(new Map());
  const shotFlightByDistanceRef = useRef<Set<string>>(new Set());
  // 距離ごとの「その距離のショットが全部片付くまで待つ」ためのtail。
  // 新しいショットがenqueueされてバッチ・送信・リトライ・後続の再帰flushが
  // 続く限り、このPromiseは解決を待ち続ける（roundTailRef/tailsRefと
  // 全く同じ、投入順に.then()で連結していくだけの単純な仕組み）。距離の
  // 設定変更はenqueue時点でこれを読むだけでよく、個別の待ち合わせ・通知
  // ロジックを別途持つ必要がない。
  const shotTailByDistanceRef = useRef<Map<string, Promise<void>>>(new Map());
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
      // 制約があるため、送信前にその距離の未送信ショットバッチ（distance単位
      // のtail）が片付くのを待つ（例: オフライン中の「ショットを全クリア→
      // 距離の構成変更」の順序を、送信順でも保つ）。
      const shotWaitTail =
        input.operation?.type === "distance.updated"
          ? (shotTailByDistanceRef.current.get(input.operation.distanceId) ??
            Promise.resolve())
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
    [settleKeys, onPermanentFailure],
  );

  // 指定した距離の、現在たまっている未送信ショットバッチを送信する。
  // 距離ごとに完全に独立した直列tail（shotTailByDistanceRef）として動作し、
  // 戻り値のPromiseは「今回の送信」だけでなく、その最中・その後に新たに
  // 積まれた分の再帰的な送信も含めて、その距離のショットが完全に片付くまで
  // 解決しない。distance側はこのtailを読むだけで「その距離のショットが
  // 片付くまで待つ」を実現できる。
  const flushShots = useCallback(
    (distanceId: string, runBatch: RunShotBatch): Promise<void> => {
      if (shotFlightByDistanceRef.current.has(distanceId)) {
        return (
          shotTailByDistanceRef.current.get(distanceId) ?? Promise.resolve()
        );
      }
      const batch = shotBatchByDistanceRef.current.get(distanceId);
      if (!batch || batch.size === 0) return Promise.resolve();

      shotFlightByDistanceRef.current.add(distanceId);
      const items = Array.from(batch.values());
      shotBatchByDistanceRef.current.set(distanceId, new Map());

      const attempt = (
        pending: EnqueueShotInput[],
        attemptIndex: number,
      ): Promise<void> => {
        // リトライ実行時点で既に新しい値が積まれているkeyは、古い値を送らず
        // 除外する（新しい入力が待機中のリトライより優先される。その新しい
        // 値自体は、現在のバッチ・次の再帰flushで別途送られる）。
        const currentBatch = shotBatchByDistanceRef.current.get(distanceId);
        const itemsToRetry = pending.filter(
          (item) => !currentBatch?.has(item.key),
        );
        if (itemsToRetry.length === 0) return Promise.resolve();

        const upsert = itemsToRetry
          .map((i) => i.upsert)
          .filter((s): s is ShotUpsert => s !== undefined);
        const clear = itemsToRetry
          .map((i) => i.clear)
          .filter((s): s is ShotClear => s !== undefined);

        return toSafeResult(runBatch({ upsert, clear })).then((result) => {
          if (
            result?.error &&
            result.error !== AUTH_REQUIRED_MESSAGE &&
            !isPermanentFailure(result) &&
            (itemsToRetry.some((item) => item.operation) ||
              attemptIndex < RETRY_DELAYS_MS.length)
          ) {
            // このタイマー自体は誰にも参照されない。同じマスへの新しい入力に
            // よるキャンセルは、発火時にitemsToRetryをshotBatchByDistanceRef
            // と照合するfilterで行う（バッチ全体を打ち切る必要は無いため）。
            setShotRetryingDistances((prev) => new Set(prev).add(distanceId));
            return new Promise<void>((resolve) => {
              setTimeout(
                () => {
                  setShotRetryingDistances((prev) => {
                    const next = new Set(prev);
                    next.delete(distanceId);
                    return next;
                  });
                  attempt(itemsToRetry, attemptIndex + 1).then(resolve);
                },
                RETRY_DELAYS_MS[
                  Math.min(attemptIndex, RETRY_DELAYS_MS.length - 1)
                ],
              );
            });
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
          setShotPendingKeys((prev) => {
            const next = new Set(prev);
            for (const item of itemsToRetry) next.delete(item.key);
            return next;
          });
        });
      };

      const resultPromise = attempt(items, 0).then(() => {
        shotFlightByDistanceRef.current.delete(distanceId);
        // 送信中・リトライ待機中に新しく積まれた分があれば、続けて送る
        // （このthenチェーンに連結されるため、tailは全体が片付くまで
        // 解決しない）。
        return flushShots(distanceId, runBatch);
      });
      shotTailByDistanceRef.current.set(distanceId, resultPromise);
      return resultPromise;
    },
    [settleKeys, onPermanentFailure],
  );

  const scheduleShot = useCallback(
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
        const distanceId = distanceIdOf(input);
        if (!distanceId) return;
        const batch =
          shotBatchByDistanceRef.current.get(distanceId) ??
          new Map<string, EnqueueShotInput>();
        // 同じマスへの連続上書きは、送信済みでなければ最後の値だけが残る。
        const previous = batch.get(input.key);
        if (previous?.operation) {
          // 同じマスへの未送信の古い値は最終状態に不要なため、永続outbox
          // からも取り除く。これにより再読み込み後に古い入力が再生
          // されない。
          void removePendingOperation(eventIdOf(previous.operation));
        }
        batch.set(input.key, input);
        shotBatchByDistanceRef.current.set(distanceId, batch);
        flushShots(distanceId, runBatch);
      });
    },
    [flushShots],
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
    retryingKeys.size > 0 || shotRetryingDistances.size > 0
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
