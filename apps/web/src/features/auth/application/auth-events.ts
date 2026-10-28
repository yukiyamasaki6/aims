import type { SessionEvent } from "../domain/session-event";

// 認証状態の変化の通知。端末の識別情報の記録と、セッション保護が使う。
// 購読を解除する関数を返す。
export type AuthEvents = {
  subscribe(listener: (event: SessionEvent) => void): () => void;
};
