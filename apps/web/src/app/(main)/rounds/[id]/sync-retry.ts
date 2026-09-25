import type {
  SyncRetry,
  SyncRetryAttempt,
  SyncRetryOptions,
} from "./sync-queue-types";

// 試行ごとのリトライ待機と、オフライン中の見送り・オンライン復帰時の再開を、idごとに管理する。
// 試行前にオフラインなら送らず、オンライン復帰時に同じ番号で再開する（見送りはリトライ回数を消費しない）。
// リトライ待機中にオフラインになった場合は待機を打ち切り、オンライン復帰時に次の番号で再開する。
export function createSyncRetry({
  isOffline,
  onRetryingChange,
  onOfflinePendingChange,
}: SyncRetryOptions): SyncRetry {
  // `offline`/`online`イベントで即座にキャンセル・再開できるよう、進行中のリトライ待機と再開処理をidごとに保持する。
  const retryCancels = new Map<string, () => void>();
  const offlineResumes = new Map<string, () => void>();

  const resumeWhenOnline = (
    id: string,
    resume: () => Promise<void>,
    resolve: () => void,
  ) => {
    onOfflinePendingChange(id, true);
    offlineResumes.set(id, () => {
      offlineResumes.delete(id);
      onOfflinePendingChange(id, false);
      resume().then(resolve);
    });
  };

  const run = (id: string, attempt: SyncRetryAttempt): Promise<void> => {
    const attemptAt = (attemptIndex: number): Promise<void> => {
      if (isOffline()) {
        return new Promise<void>((resolve) => {
          resumeWhenOnline(id, () => attemptAt(attemptIndex), resolve);
        });
      }
      return attempt(attemptIndex, (delayMs) => {
        onRetryingChange(id, true);
        return new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            retryCancels.delete(id);
            onRetryingChange(id, false);
            attemptAt(attemptIndex + 1).then(resolve);
          }, delayMs);
          retryCancels.set(id, () => {
            clearTimeout(timer);
            retryCancels.delete(id);
            onRetryingChange(id, false);
            resumeWhenOnline(id, () => attemptAt(attemptIndex + 1), resolve);
          });
        });
      });
    };
    return attemptAt(0);
  };

  return {
    run,
    handleOffline: () => {
      for (const cancel of [...retryCancels.values()]) cancel();
    },
    handleOnline: () => {
      for (const resume of [...offlineResumes.values()]) resume();
    },
  };
}
