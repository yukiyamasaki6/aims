// 認証サービスが発行する認証コード(OTP)の規則。桁数(入力欄の上限)と、再送できるまでの待ち時間。
// コードの正しさは送信前に検査せず、認証サービスの確認に任せる。
export const AUTH_CODE_LENGTH = 6;

// 認証コードを送ってから、再送できるまでの待ち時間(秒)。
export const RESEND_COOLDOWN_SECONDS = 60;

// 再送の待ちの誤りの種類。cooldown: 待ち時間が残っている。
export type ResendWaitError = "cooldown";

// 待ち時間が残っていれば誤りの種類を、無ければundefinedを返す。
export function validateResendWait(
  remainingSeconds: number,
): ResendWaitError | undefined {
  return remainingSeconds > 0 ? "cooldown" : undefined;
}
