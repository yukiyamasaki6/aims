// サインインの変化の通知。端末の識別情報の記録、セッション保護、同期とラウンドの記録が使う。
// signed-in: 利用者がいる(サインイン、起動時のセッションの復元)。token-refreshed: 同じ利用者のトークンの更新。signed-out: 利用者が消えた。
// 利用者がいないままの出来事(セッションが無い起動時、パスワードの再設定の途中など)は通知しない。
// token-refreshedを分けるのは、取得の認証の拒否が起こす強制更新の通知で、同期が取得を始め直す循環を避けるためである。
export type SignInChange =
  | { readonly kind: "signed-in"; readonly userId: string }
  | { readonly kind: "token-refreshed"; readonly userId: string }
  | { readonly kind: "signed-out" };

// サインインの変化の購読。購読を解除する関数を返す。
// 例外: 接続を得られないときは同期に投げる(環境変数は本番で必ずあり、欠落は起動の不備である)。手続きは扱わない。
export type SignInChanges = {
  subscribe(listener: (change: SignInChange) => void): () => void;
};
