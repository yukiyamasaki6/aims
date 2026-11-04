// セキュリティチェックのトークン。チェックが完了していれば、トークンがある。
// 誤りの種類。incomplete: チェックが完了していない。
export type CaptchaError = "incomplete";

export function isCaptchaCompleted(token: string | null): token is string {
  return token !== null && token !== "";
}
