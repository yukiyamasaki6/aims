import type { AuthError } from "@supabase/supabase-js";
import type { SessionState } from "./session-state";

export const AUTH_REQUIRED_MESSAGE = "サインインが必要です。";

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
  // ネットワーク断・DNS失敗等はGoTrueクライアント側でAuthRetryableFetchErrorに
  // 分類され、error.codeが付かないままerror.message（ブラウザの生の"Failed to
  // fetch"等）が返ってくるため、AUTH_ERROR_MESSAGESより先にnameで判定する。
  if (error.name === "AuthRetryableFetchError") {
    return "通信エラーが発生しました。しばらくしてから再度お試しください。";
  }

  if (error.code && error.code in AUTH_ERROR_MESSAGES) {
    return AUTH_ERROR_MESSAGES[error.code];
  }

  return error.message;
}

// 未認証はサインインを促し、不明（通信失敗）は通信できないことを示す。
export function sessionFailureMessage(
  state: Exclude<SessionState, { status: "authenticated" }>,
): string {
  return state.status === "unauthenticated"
    ? AUTH_REQUIRED_MESSAGE
    : translateAuthErrorMessage(state.error);
}
