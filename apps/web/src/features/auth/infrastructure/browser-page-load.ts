import type { PageLoad } from "../application/reset-password";

// ページ全体を読み込み直して遷移する(ハードナビゲーション)。routerの遷移では、前の画面の状態とクライアントのキャッシュが残る。
export function createBrowserPageLoad(): PageLoad {
  return { load: (path) => window.location.assign(path) };
}
