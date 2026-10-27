// 認証サービスが発行する認証コード(OTP)の桁数(固定)。
export const AUTH_CODE_LENGTH = 6;
const PATTERN = new RegExp(`^\\d{${AUTH_CODE_LENGTH}}$`);

// 正しければundefined、誤りなら利用者向けの文言を返す。
export function validateAuthCode(code: string): string | undefined {
  if (!code) return "認証コードを入力してください。";
  if (!PATTERN.test(code)) {
    return `認証コードは${AUTH_CODE_LENGTH}桁の数字で入力してください。`;
  }
  return undefined;
}
