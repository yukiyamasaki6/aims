// 認証サービスが発行する認証コード(OTP)の規則。桁数と、再送できるまでの待ち時間。
export const AUTH_CODE_LENGTH = 6;
const PATTERN = new RegExp(`^\\d{${AUTH_CODE_LENGTH}}$`);

// 認証コードを送ってから、再送できるまでの待ち時間(秒)。
export const RESEND_COOLDOWN_SECONDS = 60;

// 正しければundefined、誤りなら利用者向けの文言を返す。
export function validateAuthCode(code: string): string | undefined {
  if (!code) return "認証コードを入力してください。";
  if (!PATTERN.test(code)) {
    return `認証コードは${AUTH_CODE_LENGTH}桁の数字で入力してください。`;
  }
  return undefined;
}

// 待ち時間が残っていれば利用者向けの文言を、無ければundefinedを返す。
export function validateResendWait(
  remainingSeconds: number,
): string | undefined {
  return remainingSeconds > 0
    ? "再送はクールダウン中です。しばらくしてから再度お試しください。"
    : undefined;
}
