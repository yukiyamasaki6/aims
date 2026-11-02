import type { Connectivity } from "../contract/connectivity";

// navigator.onLineは実際の通信可否を保証しない。falseのときだけオフラインと確定する。
function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function subscribe(
  type: "online" | "offline",
  listener: () => void,
): () => void {
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}

export function createBrowserConnectivity(): Connectivity {
  return {
    isOffline,
    onOnline: (listener) => subscribe("online", listener),
    onOffline: (listener) => subscribe("offline", listener),
  };
}
