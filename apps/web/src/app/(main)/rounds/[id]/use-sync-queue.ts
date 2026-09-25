import { useCallback, useEffect, useRef, useState } from "react";
import { getLocalIdentity } from "@/features/auth/local-identity";
import { eventIdOf, executeSyncOperation } from "./sync-events";
import {
  loadPendingOperations,
  removePendingOperation,
  savePendingOperation,
} from "./sync-outbox";
import type {
  BatchResult,
  EnqueueInput,
  EnqueueShotInput,
  ShotBatch,
  SyncError,
} from "./sync-queue-types";
import { orderByDependency, toRestoredInput } from "./sync-restore";
import { decideSyncResult, toSafeResult } from "./sync-result";
import {
  distanceIdOf,
  excludeSuperseded,
  toShotBatch,
} from "./sync-shot-batch";
import { syncShots } from "./sync-shots";
import { deriveSyncStatus } from "./sync-status";

type RunShotBatch = (batch: ShotBatch) => Promise<BatchResult>;

// navigator.onLineは実際の通信可否を保証しないが、誤ってオンライン判定
// された場合は通常のバックオフリトライに任せる。
function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// 何も積まれていないtailの目印。schedule()がこれと参照一致する間は
// 待つべきものが無いと判定し、attempt(0)を同期的に呼べる。
const RESOLVED_TAIL: Promise<unknown> = Promise.resolve();

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
  // 距離ごとに独立してリトライ待機し得るため集合で持つ。
  const [shotRetryingDistances, setShotRetryingDistances] = useState<
    Set<string>
  >(new Set());
  const [offlinePendingKeys, setOfflinePendingKeys] = useState<Set<string>>(
    new Set(),
  );
  const [shotOfflinePendingDistances, setShotOfflinePendingDistances] =
    useState<Set<string>>(new Set());
  const roundTailRef = useRef<Promise<unknown>>(RESOLVED_TAIL);
  const tailsRef = useRef<Map<string, Promise<unknown>>>(new Map());
  // 距離ごとに独立したショットの未送信バッチ・送信中フラグ・直列tail
  // （サーバーが距離ごとの行ロックしか取らないのと同じ粒度）。
  const shotBatchByDistanceRef = useRef<
    Map<string, Map<string, EnqueueShotInput>>
  >(new Map());
  const shotFlightByDistanceRef = useRef<Set<string>>(new Set());
  const shotTailByDistanceRef = useRef<Map<string, Promise<void>>>(new Map());
  // `offline`/`online`イベントで即座にキャンセル・再開できるよう、
  // 進行中のリトライタイマーと再開処理をkey/distanceIdごとに保持する。
  const retryTimersRef = useRef<Map<string, { cancel: () => void }>>(new Map());
  const shotRetryTimersRef = useRef<Map<string, { cancel: () => void }>>(
    new Map(),
  );
  const offlineResumeRef = useRef<Map<string, () => void>>(new Map());
  const shotOfflineResumeRef = useRef<Map<string, () => void>>(new Map());
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
      // 新しい楽観値の表示を優先するため、直前の失敗表示だけ上書きする
      // （古い操作自体は打ち切らず、共有tailの投入順のまま実行される）。
      setErrorMap((prev) => {
        if (!prev.has(input.key)) return prev;
        const copy = new Map(prev);
        copy.delete(input.key);
        return copy;
      });
      setPendingCount((n) => n + 1);

      const hasOwnTail = roundTailRef.current !== RESOLVED_TAIL;
      const hasDepTail = Boolean(
        input.dependsOnKey && tailsRef.current.has(input.dependsOnKey),
      );
      const shotWaitDistanceId =
        input.operation?.type === "distance.updated"
          ? input.operation.distanceId
          : undefined;
      const hasShotWaitTail = Boolean(
        shotWaitDistanceId &&
          shotTailByDistanceRef.current.has(shotWaitDistanceId),
      );

      const ownTail = roundTailRef.current;
      const depTail = input.dependsOnKey
        ? (tailsRef.current.get(input.dependsOnKey) ?? RESOLVED_TAIL)
        : RESOLVED_TAIL;
      // distance.updatedは、得点が残る距離の構成列を変更できないという
      // サーバー制約に合わせ、同じ距離の未送信ショットバッチが片付くのを待つ。
      const shotWaitTail = shotWaitDistanceId
        ? (shotTailByDistanceRef.current.get(shotWaitDistanceId) ??
          RESOLVED_TAIL)
        : RESOLVED_TAIL;

      const attempt = (attemptIndex: number): Promise<void> => {
        // オフラインなら送らず、online復帰まで待って同じattemptIndexで
        // 再開する（見送りはリトライ回数を消費しない）。
        if (isOffline()) {
          return new Promise<void>((resolve) => {
            setOfflinePendingKeys((prev) => new Set(prev).add(input.key));
            offlineResumeRef.current.set(input.key, () => {
              offlineResumeRef.current.delete(input.key);
              setOfflinePendingKeys((prev) => {
                const next = new Set(prev);
                next.delete(input.key);
                return next;
              });
              attempt(attemptIndex).then(resolve);
            });
          });
        }

        return toSafeResult(
          input.operation
            ? executeSyncOperation(input.operation)
            : (input.run?.() ??
                Promise.resolve({ error: "同期する操作が見つかりません。" })),
        ).then((result) => {
          const decision = decideSyncResult(result, attemptIndex);
          if (decision.type === "retry") {
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
              }, decision.delayMs);
              retryTimersRef.current.set(input.key, {
                cancel: () => {
                  clearTimeout(timer);
                  retryTimersRef.current.delete(input.key);
                  setRetryingKeys((prev) => {
                    const next = new Set(prev);
                    next.delete(input.key);
                    return next;
                  });
                  setOfflinePendingKeys((prev) => new Set(prev).add(input.key));
                  offlineResumeRef.current.set(input.key, () => {
                    offlineResumeRef.current.delete(input.key);
                    setOfflinePendingKeys((prev) => {
                      const next = new Set(prev);
                      next.delete(input.key);
                      return next;
                    });
                    attempt(attemptIndex + 1).then(resolve);
                  });
                },
              });
            });
          }
          settleKeys([input], result);
          if (decision.removeFromOutbox && input.operation) {
            void removePendingOperation(eventIdOf(input.operation));
          }
          if (decision.notifyPermanentFailure) {
            onPermanentFailure?.();
          }
          setPendingCount((n) => n - 1);
        });
      };

      const runPromise =
        !hasOwnTail && !hasDepTail && !hasShotWaitTail
          ? attempt(0)
          : Promise.all([ownTail, depTail, shotWaitTail]).then(() =>
              attempt(0),
            );
      roundTailRef.current = runPromise;
      tailsRef.current.set(input.key, runPromise);
    },
    [settleKeys, onPermanentFailure],
  );

  // 戻り値のPromiseは、今回の送信中・後に新たに積まれた分の再帰的な送信も
  // 含め、この距離のショットが完全に片付くまで解決しない。
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
        // schedule()側のattemptと同じオフライン判定。
        if (isOffline()) {
          return new Promise<void>((resolve) => {
            setShotOfflinePendingDistances((prev) =>
              new Set(prev).add(distanceId),
            );
            shotOfflineResumeRef.current.set(distanceId, () => {
              shotOfflineResumeRef.current.delete(distanceId);
              setShotOfflinePendingDistances((prev) => {
                const next = new Set(prev);
                next.delete(distanceId);
                return next;
              });
              attempt(pending, attemptIndex).then(resolve);
            });
          });
        }

        const itemsToRetry = excludeSuperseded(
          pending,
          shotBatchByDistanceRef.current.get(distanceId),
        );
        if (itemsToRetry.length === 0) return Promise.resolve();

        return toSafeResult(runBatch(toShotBatch(itemsToRetry))).then(
          (result) => {
            const decision = decideSyncResult(result, attemptIndex);
            if (decision.type === "retry") {
              setShotRetryingDistances((prev) => new Set(prev).add(distanceId));
              return new Promise<void>((resolve) => {
                const timer = setTimeout(() => {
                  shotRetryTimersRef.current.delete(distanceId);
                  setShotRetryingDistances((prev) => {
                    const next = new Set(prev);
                    next.delete(distanceId);
                    return next;
                  });
                  attempt(itemsToRetry, attemptIndex + 1).then(resolve);
                }, decision.delayMs);
                shotRetryTimersRef.current.set(distanceId, {
                  cancel: () => {
                    clearTimeout(timer);
                    shotRetryTimersRef.current.delete(distanceId);
                    setShotRetryingDistances((prev) => {
                      const next = new Set(prev);
                      next.delete(distanceId);
                      return next;
                    });
                    setShotOfflinePendingDistances((prev) =>
                      new Set(prev).add(distanceId),
                    );
                    shotOfflineResumeRef.current.set(distanceId, () => {
                      shotOfflineResumeRef.current.delete(distanceId);
                      setShotOfflinePendingDistances((prev) => {
                        const next = new Set(prev);
                        next.delete(distanceId);
                        return next;
                      });
                      attempt(itemsToRetry, attemptIndex + 1).then(resolve);
                    });
                  },
                });
              });
            }
            settleKeys(itemsToRetry, result);
            if (decision.removeFromOutbox) {
              for (const item of itemsToRetry) {
                if (item.operation) {
                  void removePendingOperation(eventIdOf(item.operation));
                }
              }
            }
            if (decision.notifyPermanentFailure) {
              onPermanentFailure?.();
            }
            setShotPendingKeys((prev) => {
              const next = new Set(prev);
              for (const item of itemsToRetry) next.delete(item.key);
              return next;
            });
          },
        );
      };

      const resultPromise = attempt(items, 0).then(() => {
        shotFlightByDistanceRef.current.delete(distanceId);
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

      const proceed = () => {
        const distanceId = distanceIdOf(input);
        if (!distanceId) return;
        const batch =
          shotBatchByDistanceRef.current.get(distanceId) ??
          new Map<string, EnqueueShotInput>();
        // 同じマスへの未送信の古い値は不要なため、永続outboxからも
        // 取り除く（再読み込み後に古い入力が再生されないように）。
        const previous = batch.get(input.key);
        if (previous?.operation) {
          void removePendingOperation(eventIdOf(previous.operation));
        }
        batch.set(input.key, input);
        shotBatchByDistanceRef.current.set(distanceId, batch);
        flushShots(distanceId, runBatch);
      };

      // dependsOnKey先に何も走っていなければ、1ティックの遅延を挟まず
      // 同期的にバッチへ積む（schedule()側と同種の理由）。
      if (input.dependsOnKey && tailsRef.current.has(input.dependsOnKey)) {
        tailsRef.current.get(input.dependsOnKey)?.then(proceed);
      } else {
        proceed();
      }
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
        userId: getLocalIdentity(),
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
        userId: getLocalIdentity(),
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
    const handleOnline = () => {
      const resumes = [
        ...offlineResumeRef.current.values(),
        ...shotOfflineResumeRef.current.values(),
      ];
      for (const resume of resumes) resume();
    };
    const handleOffline = () => {
      const cancels = [
        ...retryTimersRef.current.values(),
        ...shotRetryTimersRef.current.values(),
      ];
      for (const entry of cancels) entry.cancel();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!roundId || restoredRef.current) return;
    restoredRef.current = true;
    void loadPendingOperations(roundId, getLocalIdentity()).then(
      (operations) => {
        for (const pending of orderByDependency(operations)) {
          const restored = toRestoredInput(pending);
          if (restored.type === "shot") {
            scheduleShot(restored.input, syncShots);
          } else {
            schedule(restored.input);
          }
        }
      },
    );
  }, [roundId, schedule, scheduleShot]);

  const errorFor = useCallback(
    (key: string) => errorMap.get(key)?.message,
    [errorMap],
  );

  const status = deriveSyncStatus({
    offlinePending: offlinePendingKeys.size + shotOfflinePendingDistances.size,
    retrying: retryingKeys.size + shotRetryingDistances.size,
    sending: persistingCount + pendingCount + shotPendingKeys.size,
    errors: errorMap.size,
  });

  return {
    status,
    errors: Array.from(errorMap.values()),
    errorFor,
    enqueue,
    enqueueShot,
  };
}
