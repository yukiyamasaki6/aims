import type { Connectivity } from "./contract/connectivity";

export type FakeConnectivity = Connectivity & {
  // 通信の可否を替え、購読者へ知らせる。
  goOffline(): void;
  goOnline(): void;
  // 購読している数。
  subscribers(): { online: number; offline: number };
};

// 通信の可否と、戻った・切れた通知を、テストが動かせる実装。
export function createFakeConnectivity(offline = false): FakeConnectivity {
  let isOffline = offline;
  const onlineListeners = new Set<() => void>();
  const offlineListeners = new Set<() => void>();

  function subscribe(listeners: Set<() => void>, listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    isOffline: () => isOffline,
    onOnline: (listener) => subscribe(onlineListeners, listener),
    onOffline: (listener) => subscribe(offlineListeners, listener),
    goOffline() {
      isOffline = true;
      for (const listener of [...offlineListeners]) listener();
    },
    goOnline() {
      isOffline = false;
      for (const listener of [...onlineListeners]) listener();
    },
    subscribers: () => ({
      online: onlineListeners.size,
      offline: offlineListeners.size,
    }),
  };
}
