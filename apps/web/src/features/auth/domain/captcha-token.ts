// セキュリティチェックのトークン。チェックが完了していれば、トークンがある。
export const CAPTCHA_INCOMPLETE_MESSAGE =
  "セキュリティチェックが完了していません。";

export function isCaptchaCompleted(token: string | null): token is string {
  return token !== null && token !== "";
}
