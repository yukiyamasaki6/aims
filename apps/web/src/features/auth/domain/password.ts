// パスワードの規則。入力されたかを見る規則と、登録時と再設定時の強さの規則。サインインは強さを課さない。
// 強さの規則の数値は、ここだけが持つ(認証サービスの設定と合わせる)。
export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;
// bcryptは72バイトを超えた部分を無視する。許す文字は半角英数記号だけなので、文字数をバイト数として扱える。
const ALLOWED_PATTERN = /^[!-~]*$/;

// 入力されたパスワードが空でないかだけを見る。
// 入力されていればundefined、空なら利用者向けの文言を返す。
export function validatePasswordPresent(password: string): string | undefined {
  return password ? undefined : "パスワードを入力してください。";
}

// 正しければundefined、誤りなら利用者向けの文言を返す。
export function validateNewPassword(password: string): string | undefined {
  const missing = validatePasswordPresent(password);
  if (missing) return missing;
  const valid =
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    ALLOWED_PATTERN.test(password) &&
    /[a-zA-Z]/.test(password) &&
    /[0-9]/.test(password);
  return valid
    ? undefined
    : `パスワードは${PASSWORD_MIN_LENGTH}文字以上${PASSWORD_MAX_LENGTH}文字以内の半角英数記号で、英字と数字の両方を含めてください。`;
}
