import type { PageReplace } from "../application/page-replace";

// ページ全体を読み込み直して遷移する(ハードナビゲーション)。routerの遷移では、前の画面の状態とクライアントのキャッシュが残る。
// replace: 履歴に残さず置き換える遷移。reload: 今の文書の読み込み直し。here: 今の場所(パス、クエリ、ハッシュ)。
// 今の場所の読み込み直しにreplaceを使わない。ハッシュを含めて今と同じURLへの置き換えは、文書の中の移動として扱われ、読み込み直さないため。
export function createBrowserPageLoad(): PageReplace {
  return {
    replace: (path) => window.location.replace(path),
    reload: () => window.location.reload(),
    here: () =>
      window.location.pathname + window.location.search + window.location.hash,
  };
}
