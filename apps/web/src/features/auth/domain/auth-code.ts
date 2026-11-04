// 認証サービスが発行する認証コード(OTP)の規則。桁数と、再送できるまでの待ち時間。
export const AUTH_CODE_LENGTH = 6;
const PATTERN = new RegExp(`^\\d{${AUTH_CODE_LENGTH}}$`);

// 認証コードを送ってから、再送できるまでの待ち時間(秒)。
export const RESEND_COOLDOWN_SECONDS = 60;

// 認証コードの誤りの種類。required: 未入力。invalidFormat: 桁数と数字の規則に合わない。
export type AuthCodeError = "required" | "invalidFormat";

// 再送の待ちの誤りの種類。cooldown: 待ち時間が残っている。
export type ResendWaitError = "cooldown";

// 正しければundefined、誤りなら誤りの種類を返す。
export function validateAuthCode(code: string): AuthCodeError | undefined {
  if (!code) return "required";
  if (!PATTERN.test(code)) return "invalidFormat";
  return undefined;
}

// 待ち時間が残っていれば誤りの種類を、無ければundefinedを返す。
export function validateResendWait(
  remainingSeconds: number,
): ResendWaitError | undefined {
  return remainingSeconds > 0 ? "cooldown" : undefined;
}
