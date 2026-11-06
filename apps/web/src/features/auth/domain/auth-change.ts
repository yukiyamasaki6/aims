// サインインの状態の分類と、セッションの喪失の定義。
// 認証サービスの語彙(イベントの名前)を知るのは、インフラ層の変換だけである。

// サインインの状態の3分類。確かめられないとき(通信失敗など)はunknownにする。この分類の定義は、ここだけである。
export type SessionStatus = "authenticated" | "unauthenticated" | "unknown";

// セッションの喪失は、signed-outの通知と、確かめた結果の未認証(確定)に限る。
// initialでセッションが無い状態と、確かめられない状態(通信失敗)は、通信失敗でも起きるため喪失としない。
export function lostByStatus(status: SessionStatus): boolean {
  return status === "unauthenticated";
}
