import { useSyncExternalStore } from "react";
import { vi } from "vitest";

// `next/navigation`の`useSearchParams`の偽物。URLの検索部を持ち、変わると購読する描画をやり直させる。
// jsdomでは、Next.jsが`history.replaceState`を取り込んで検索部を替える動きを再現できない。`followReplaceState`で、呼び出しに応じて検索部を替えるだけの代用にする。
let search = "";
const listeners = new Set<() => void>();

const snapshot = () => search;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const fakeSearchParams = {
  useSearchParams: () => {
    const current = useSyncExternalStore(subscribe, snapshot, snapshot);
    return new URLSearchParams(current);
  },
  // 検索部を替え、購読者へ知らせる。
  set(next: string) {
    search = next;
    for (const listener of [...listeners]) listener();
  },
  reset() {
    search = "";
    listeners.clear();
  },
};

// `history.replaceState`の呼び出しを記録し、渡されたURLの検索部へ替える。
export function followReplaceState() {
  return vi
    .spyOn(window.history, "replaceState")
    .mockImplementation((_state, _unused, url) => {
      fakeSearchParams.set(new URL(String(url), "http://localhost").search);
    });
}
