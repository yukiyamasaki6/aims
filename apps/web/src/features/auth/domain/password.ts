// パスワードの規則。入力されたかを見る規則と、登録時と再設定時の強さの規則。サインインは強さを課さない。
// 強さの規則の数値は、ここだけが持つ(認証サービスの設定と合わせる)。文言に要るため、上限と下限をexportする。
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
// bcryptは72バイトを超えた部分を無視する。許す文字は半角英数記号だけなので、文字数をバイト数として扱える。
const ALLOWED_PATTERN = /^[!-~]*$/;

// パスワードの誤りの種類。required: 未入力。invalidRule: 強さの規則に合わない。
// 認証サービスが弱いパスワードとして拒否したとき(weak_password)と、invalidRuleは、利用者に同じ規則の文面を示す。
export type PasswordError = "required" | "invalidRule";

// 入力されたパスワードが空でないかだけを見る。
// 入力されていればundefined、空なら誤りの種類を返す。
export function validatePasswordPresent(
  password: string,
): Extract<PasswordError, "required"> | undefined {
  return password ? undefined : "required";
}

// 正しければundefined、誤りなら誤りの種類を返す。
export function validateNewPassword(
  password: string,
): PasswordError | undefined {
  const missing = validatePasswordPresent(password);
  if (missing) return missing;
  const valid =
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    ALLOWED_PATTERN.test(password) &&
    /[a-zA-Z]/.test(password) &&
    /[0-9]/.test(password);
  return valid ? undefined : "invalidRule";
}
