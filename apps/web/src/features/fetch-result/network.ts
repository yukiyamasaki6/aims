// navigator.onLineは実際の通信可否を保証しない。falseのときだけオフラインと確定する。
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
