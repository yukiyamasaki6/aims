import type { AuthError } from "@supabase/supabase-js";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "メールアドレスまたはパスワードが間違っています。",
  otp_expired: "認証コードが正しくないか、有効期限が切れています。",
  over_email_send_rate_limit:
    "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
  over_request_rate_limit:
    "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
  captcha_failed: "認証に失敗しました。もう一度お試しください。",
  weak_password: "パスワードは8文字以上で、英字と数字の両方を含めてください。",
};

export function translateAuthErrorMessage(error: AuthError): string {
  if (error.code && error.code in AUTH_ERROR_MESSAGES) {
    return AUTH_ERROR_MESSAGES[error.code];
  }

  return error.message;
}
