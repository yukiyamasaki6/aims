import { PASSWORD_RULE_MESSAGE } from "./password";

// 認証の失敗の種類と、利用者向けの文言。サインイン、サインアップ、パスワード再設定、サインアウト、他の機能が使う。
// 利用者向けの文言は、この表だけが持つ。種類を作るのは、認証サービスのエラーを写すインフラ層(拒否の種類、other)と、手続きが判定して加える箇所(unauthenticated、already_registered)である。
// 認証サービスに届かなかった(unreachable)ことを表す語は、この種類だけである。
export const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

const MESSAGES = {
  unreachable: NETWORK_ERROR_MESSAGE,
  unauthenticated: "サインインが必要です。",
  invalid_credentials: "メールアドレスまたはパスワードが間違っています。",
  code_expired: "認証コードが正しくないか、有効期限が切れています。",
  rate_limited:
    "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
  captcha_failed: "認証に失敗しました。もう一度お試しください。",
  weak_password: PASSWORD_RULE_MESSAGE,
  already_registered: "このメールアドレスは既に登録されています。",
  other: "エラーが発生しました。しばらくしてから再度お試しください。",
} as const;

// 届かなかった、サインインしていない、認識している理由で拒否された、登録済みだった、それ以外(固定の文言。認証サービスの文言は出さない)のどれか。
export type AuthFailure = { readonly kind: keyof typeof MESSAGES };

// 種類の値。失敗値を作る箇所は、ここだけである。
export const UNREACHABLE = { kind: "unreachable" } as const;
const UNAUTHENTICATED = { kind: "unauthenticated" } as const;
export const ALREADY_REGISTERED = { kind: "already_registered" } as const;

export function failureMessage(failure: AuthFailure): string {
  return MESSAGES[failure.kind];
}

// サインインの状態を確かめられなかったときに、他の機能が利用者に示す文言。
// 未認証はサインインを促し、不明(通信失敗)は通信できないことを示す。
export function unconfirmedMessage(
  status: "unauthenticated" | "unknown",
): string {
  return failureMessage(
    status === "unauthenticated" ? UNAUTHENTICATED : UNREACHABLE,
  );
}
