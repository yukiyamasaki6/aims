// 認証の失敗の種類。サインイン、サインアップ、パスワード再設定、サインアウト、他の機能が使う。
// 利用者向けの文言は持たない。文言は、UI層の文言の一覧が種類ごとに持つ。種類を作るのは、認証サービスのエラーを写すインフラ層(拒否の種類、other)と、手続きが判定して加える箇所(unauthenticated、already_registered)である。
// 認証サービスに届かなかった(unreachable)ことを表す語は、この種類だけである。
export type AuthFailureKind =
  | "unreachable"
  | "unauthenticated"
  | "invalid_credentials"
  | "code_expired"
  | "rate_limited"
  | "captcha_failed"
  | "weak_password"
  | "already_registered"
  | "other";

// 届かなかった、サインインしていない、認識している理由で拒否された、登録済みだった、それ以外(認証サービスの文言は出さない)のどれか。
export type AuthFailure = { readonly kind: AuthFailureKind };

// 種類の値。失敗値を作る箇所は、ここだけである。
export const UNREACHABLE = { kind: "unreachable" } as const;
export const ALREADY_REGISTERED = { kind: "already_registered" } as const;
