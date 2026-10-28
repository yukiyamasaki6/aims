import type { PageLoad } from "../application/reset-password";
import type { PageReplace } from "../application/session";

// ページ全体を読み込み直して遷移する(ハードナビゲーション)。routerの遷移では、前の画面の状態とクライアントのキャッシュが残る。
// load: 履歴に残す遷移。replace: 履歴に残さず置き換える遷移。here: 今の場所(パスとクエリ)。
export function createBrowserPageLoad(): PageLoad & PageReplace {
  return {
    load: (path) => window.location.assign(path),
    replace: (path) => window.location.replace(path),
    here: () => window.location.pathname + window.location.search,
  };
}
