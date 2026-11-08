import type { Connectivity } from "./contract/connectivity";

export type FakeConnectivity = Connectivity & {
  // 通信の可否を替える。goOnlineは購読者へ知らせる。
  goOffline(): void;
  goOnline(): void;
  // 購読している数。
  subscribers(): { online: number };
};

// 通信の可否と、戻った通知を、テストが動かせる実装。
export function createFakeConnectivity(offline = false): FakeConnectivity {
  let isOffline = offline;
  const onlineListeners = new Set<() => void>();

  function subscribe(listeners: Set<() => void>, listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    isOffline: () => isOffline,
    onOnline: (listener) => subscribe(onlineListeners, listener),
    goOffline() {
      isOffline = true;
    },
    goOnline() {
      isOffline = false;
      for (const listener of [...onlineListeners]) listener();
    },
    subscribers: () => ({ online: onlineListeners.size }),
  };
}
