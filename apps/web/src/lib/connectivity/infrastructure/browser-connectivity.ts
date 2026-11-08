import type { Connectivity } from "../contract/connectivity";

// navigator.onLineは実際の通信可否を保証しない。falseのときだけオフラインと確定する。
function isOffline(): boolean {
  return navigator.onLine === false;
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  return () => window.removeEventListener("online", listener);
}

export function createBrowserConnectivity(): Connectivity {
  return {
    isOffline,
    onOnline: subscribeOnline,
  };
}
