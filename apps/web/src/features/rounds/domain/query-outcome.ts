// 問い合わせの結果の種類。外部の応答の形は持たず、インフラ層が応答をこの種類へ写す。
export type QueryOutcome<T> =
  | { status: "ok"; data: T }
  | { status: "not-found" }
  // 認証の拒否。セッションの問題かは応答だけでは決まらないため、取得の側で更新を強制して確かめる。
  | { status: "auth-rejected" }
  | { status: "comm-failure" }
  | { status: "failed" };

// 問い合わせの結果のうち、okでないもの。
export type QueryFailure = Exclude<QueryOutcome<never>, { status: "ok" }>;
