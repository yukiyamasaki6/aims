import { useEffect, useRef } from "react";

// bfcacheからの復元(`pageshow`の`persisted`)を受ける。Googleの画面からブラウザの戻るで戻ると、移る前の状態(実行中)のまま復元されうるため、呼び出し側が実行中を解く。
// onRestoreは変わっても購読し直さない(最新のものを呼ぶ)。
export function usePageRestore(onRestore: () => void): void {
  const latest = useRef(onRestore);
  useEffect(() => {
    latest.current = onRestore;
  });
  useEffect(() => {
    const listener = (event: PageTransitionEvent) => {
      if (event.persisted) latest.current();
    };
    window.addEventListener("pageshow", listener);
    return () => window.removeEventListener("pageshow", listener);
  }, []);
}
