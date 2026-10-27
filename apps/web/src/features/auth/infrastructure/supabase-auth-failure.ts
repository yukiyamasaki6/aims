import { type AuthFailure, failureMessage } from "../domain/auth-failure";

type RejectionKind = Exclude<AuthFailure["kind"], "other" | "unreachable">;

// 認証サービスが拒否したときの、エラーコードと失敗の種類の対応。認証サービスのコードを知るのは、ここだけである。
const REJECTION_KINDS = new Map<string, RejectionKind>([
  ["invalid_credentials", "invalid_credentials"],
  ["otp_expired", "code_expired"],
  ["over_email_send_rate_limit", "rate_limited"],
  ["over_request_rate_limit", "rate_limited"],
  ["captcha_failed", "captcha_failed"],
  ["weak_password", "weak_password"],
]);

type AuthServiceError = { name?: string; code?: string; message: string };

// 認証サービスのエラー(通信の断を含む)を、失敗の種類に写す。
// 通信の断はerror.codeの無いAuthRetryableFetchErrorになるため、コードより先に名前で見る。
export function toAuthFailure(error: AuthServiceError): AuthFailure {
  if (error.name === "AuthRetryableFetchError") return { kind: "unreachable" };
  const kind =
    error.code === undefined ? undefined : REJECTION_KINDS.get(error.code);
  return kind ? { kind } : { kind: "other", message: error.message };
}

// エラーから直接、利用者向けの文言を得る。手続きを通さない呼び出し元が使う。
export function authErrorMessage(error: AuthServiceError): string {
  return failureMessage(toAuthFailure(error));
}
