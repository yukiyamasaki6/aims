// 認証の失敗の種類。サインイン、サインアップ、パスワード再設定、パスワード変更、サインアウト、他の機能が使う。
// 利用者向けの文言は持たない。文言は、UI層の文言の一覧が種類ごとに持つ。種類を作るのは、認証サービスのエラーを写すインフラ層(拒否の種類、other)である。
// 認証サービスに届かなかった(unreachable)ことを表す語は、この種類だけである。
// offline は、送信の前に端末のオフラインを判定した種類で、集約だけが作る(送信していないため、認証サービスの応答からは作らない)。unreachable は、送信したが認証サービスに届かなかった種類である。
export type AuthFailureKind =
  | "offline"
  | "unreachable"
  | "invalid_credentials"
  | "code_expired"
  | "rate_limited"
  | "captcha_failed"
  | "weak_password"
  | "current_password_invalid"
  | "same_password"
  | "other";

// 届かなかった、サインインしていない、認識している理由で拒否された、それ以外(認証サービスの文言は出さない)のどれか。
export type AuthFailure = { readonly kind: AuthFailureKind };

// 種類の値。失敗値を作る箇所は、ここだけである。
export const UNREACHABLE = { kind: "unreachable" } as const;
