import type { PageAddress } from "../application/page-address";

// 今のURLの読み出しと、履歴を増やさず読み込まない書き換え(`history.replaceState`)。
// 新しい状態のオブジェクトを渡す(今の状態のNext.jsの内部の印を渡すと、Next.jsが取り込まないため。設定パネルと同じ)。
export function createBrowserPageAddress(): PageAddress {
  return {
    search: () => window.location.search,
    rewrite: (search) =>
      window.history.replaceState({}, "", window.location.pathname + search),
  };
}
