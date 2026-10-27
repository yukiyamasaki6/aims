import { validatePasswordPresent } from "./password-input";

// 登録時と再設定時のパスワードの強さの規則。サインインは強さを課さない(password-input.ts)。
// bcryptは72バイトを超えた部分を無視する。許す文字は半角英数記号だけなので、文字数をバイト数として扱える。
const MIN_LENGTH = 8;
const MAX_LENGTH = 72;
const ALLOWED_PATTERN = /^[!-~]*$/;

// 正しければundefined、誤りなら利用者向けの文言を返す。
export function validateNewPassword(password: string): string | undefined {
  const missing = validatePasswordPresent(password);
  if (missing) return missing;
  const valid =
    password.length >= MIN_LENGTH &&
    password.length <= MAX_LENGTH &&
    ALLOWED_PATTERN.test(password) &&
    /[a-zA-Z]/.test(password) &&
    /[0-9]/.test(password);
  return valid
    ? undefined
    : `パスワードは${MIN_LENGTH}文字以上${MAX_LENGTH}文字以内の半角英数記号で、英字と数字の両方を含めてください。`;
}
