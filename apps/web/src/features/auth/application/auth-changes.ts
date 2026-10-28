import type { AuthChange } from "../domain/auth-change";

// 認証状態の変化の通知。端末の識別情報の記録と、セッション保護が使う。
// 購読を解除する関数を返す。
// 例外: 接続を得られないときは同期に投げる(環境変数は本番で必ずあり、欠落は起動の不備である)。手続きは扱わない。
export type AuthChanges = {
  subscribe(listener: (change: AuthChange) => void): () => void;
};
