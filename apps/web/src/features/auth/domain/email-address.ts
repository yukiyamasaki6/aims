// RFC 5321のアドレス全体の最大長(オクテット)。メールアドレスは実務上ほぼASCIIのため、文字数をそのままバイト数とみなす。
export const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// メールアドレスの誤りの種類。required: 未入力。tooLong: 上限を超える。invalidFormat: 形式が正しくない。
export type EmailError = "required" | "tooLong" | "invalidFormat";

// 入力欄のmaxLengthはブラウザ側の制限にすぎず、回避され得るため、ここでも上限を検証する。
// 正しければundefined、誤りなら誤りの種類を返す。
export function validateEmail(email: string): EmailError | undefined {
  if (!email) return "required";
  if (email.length > EMAIL_MAX_LENGTH) return "tooLong";
  if (!EMAIL_PATTERN.test(email)) return "invalidFormat";
  return undefined;
}
