// RFC 5321のアドレス全体の最大長(オクテット)。メールアドレスは実務上ほぼASCIIのため、文字数をそのままバイト数とみなす。
export const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 入力欄のmaxLengthはブラウザ側の制限にすぎず、回避され得るため、ここでも上限を検証する。
// 正しければundefined、誤りなら利用者向けの文言を返す。
export function validateEmail(email: string): string | undefined {
  if (!email) return "メールアドレスを入力してください。";
  if (email.length > EMAIL_MAX_LENGTH) {
    return `メールアドレスは${EMAIL_MAX_LENGTH}文字以内で入力してください。`;
  }
  if (!EMAIL_PATTERN.test(email))
    return "メールアドレスの形式が正しくありません。";
  return undefined;
}
