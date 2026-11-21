import type { AccountSummary } from "../domain/account-summary";

// サインインの変化の通知。端末の識別情報の記録、セッション保護、同期とラウンドの記録が使う。
// signed-in: 利用者がいる(サインイン、起動時のセッションの復元)。signed-out: 利用者が消えた。
// summary: 利用者のアカウントの概要(メールアドレス、行に示すGoogleの手段。認証サービスの応答の`identities`から作る)。読めないときはnull。
// 利用者がいないままの出来事(セッションが無い起動時、パスワードの再設定の途中など)と、トークンの更新は通知しない。
// トークンの更新を通知しないことで、取得の認証の拒否が起こす強制更新が、同期の取得を始め直さない。
export type SignInChange =
  | {
      readonly kind: "signed-in";
      readonly userId: string;
      readonly summary: AccountSummary | null;
    }
  | { readonly kind: "signed-out" };

// サインインの変化の購読。購読を解除する関数を返す。
// 例外: 接続を得られないときは同期に投げる(環境変数は本番で必ずあり、欠落は起動の不備である)。手続きは扱わない。
export type SignInChanges = {
  subscribe(listener: (change: SignInChange) => void): () => void;
};
