// 認証の失敗の種類と、利用者向けの文言。サインイン、サインアップ、パスワード再設定、サインアウトが共有する。
// 認証サービスのエラーをこの種類に写すのは、インフラ層の`supabase-auth-failure.ts`である。
export const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

// サインインしていないために、他の機能の操作が進められないときの文言。
export const AUTH_REQUIRED_MESSAGE = "サインインが必要です。";

// 種類ごとの文言。画面ごとに、返る種類が違う。
const MESSAGES = {
  unreachable: NETWORK_ERROR_MESSAGE,
  invalid_credentials: "メールアドレスまたはパスワードが間違っています。",
  code_expired: "認証コードが正しくないか、有効期限が切れています。",
  rate_limited:
    "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
  captcha_failed: "認証に失敗しました。もう一度お試しください。",
  weak_password: "パスワードは8文字以上で、英字と数字の両方を含めてください。",
  already_registered: "このメールアドレスは既に登録されています。",
} as const;

// 認証サービスに届かなかった、認識している理由で拒否された、登録済みだった、それ以外(認証サービスの文言をそのまま使う)のどれか。
export type AuthFailure =
  | { readonly kind: keyof typeof MESSAGES }
  | { readonly kind: "other"; readonly message: string };

export function failureMessage(failure: AuthFailure): string {
  return failure.kind === "other" ? failure.message : MESSAGES[failure.kind];
}
