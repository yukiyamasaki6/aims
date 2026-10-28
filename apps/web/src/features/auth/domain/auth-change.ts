// 認証状態の変化(出来事)が、端末の識別情報とセッション喪失に及ぼす結果の規則と、サインインの状態の分類。
// 認証サービスの語彙(イベントの名前)を知るのは、インフラ層の変換だけである。

// 認証状態の変化。userIdは、変化の時点でサインインしている利用者(いなければnull)。
export type AuthChange =
  | { readonly kind: "signed-in" | "initial"; readonly userId: string | null }
  | { readonly kind: "signed-out" }
  | { readonly kind: "other" };

export type IdentityChange =
  | { readonly kind: "record"; readonly userId: string }
  | { readonly kind: "clear" }
  | { readonly kind: "keep" };

// 端末の識別情報の更新・削除は、認証状態の変化だけを情報源とし、個々のAPI呼び出しの成否には依存させない。
// サインアウトの通信が失敗してもローカルのセッションの削除は必ず行われ、signed-outが確実に起きるため、これを唯一の信頼できるクリアのきっかけとする。
// 記録はsigned-inだけでなく、initialでも行う(クリアはしない)。ページを再読み込みして既存のセッションが復元されるとき、起きるのはinitialであり、
// これを無視すると、既にサインイン済みの利用者の識別情報がいつまでも設定されない。
// initialでセッションが無いのは、「未サインイン」ではなく「オフラインなどで確かめられなかった」可能性があるため、既存の記録は消さない。
export function identityChange(change: AuthChange): IdentityChange {
  if (change.kind === "signed-out") return { kind: "clear" };
  if (change.kind === "other" || !change.userId) return { kind: "keep" };
  return { kind: "record", userId: change.userId };
}

// サインインの状態の3分類。確かめられないとき(通信失敗など)はunknownにする。この分類の定義は、ここだけである。
export type SessionStatus = "authenticated" | "unauthenticated" | "unknown";

// セッションの喪失は、signed-outと、確かめた結果の未認証(確定)に限る。
// initialでセッションが無い状態と、確かめられない状態(通信失敗)は、通信失敗でも起きるため喪失としない。
export function lostByChange(change: AuthChange): boolean {
  return change.kind === "signed-out";
}

export function lostByStatus(status: SessionStatus): boolean {
  return status === "unauthenticated";
}
