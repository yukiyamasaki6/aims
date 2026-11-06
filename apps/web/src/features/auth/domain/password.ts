// パスワードの規則。入力されたかを見る規則と、登録時と再設定時の文字種の規則。サインインは文字種を課さない。
// 文字種の制限(半角英数記号のみ)はユーザー判断で、ここで検査する。長さと強さ(英字と数字を含むこと)の正本は認証サービスで、拒否はweak_passwordとして返り、利用者に同じ規則の文面を示す。
// 規則の文面に要るため、上限と下限をexportする。数値は認証サービスの設定と合わせる。
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
// bcryptは72バイトを超えた部分を無視する。許す文字は半角英数記号だけなので、文字数をバイト数として扱える。
const ALLOWED_PATTERN = /^[!-~]*$/;

// パスワードの誤りの種類。required: 未入力。invalidRule: 許す文字以外を含む。
// 認証サービスが弱いパスワードとして拒否したとき(weak_password)と、invalidRuleは、利用者に同じ規則の文面を示す。
export type PasswordError = "required" | "invalidRule";

// 入力されたパスワードが空でないかだけを見る。
// 入力されていればundefined、空なら誤りの種類を返す。
export function validatePasswordPresent(
  password: string,
): Extract<PasswordError, "required"> | undefined {
  return password ? undefined : "required";
}

// 空でなく、許す文字だけなら誤りなし。長さと強さは認証サービスが拒否する。
// 正しければundefined、誤りなら誤りの種類を返す。
export function validateNewPassword(
  password: string,
): PasswordError | undefined {
  const missing = validatePasswordPresent(password);
  if (missing) return missing;
  return ALLOWED_PATTERN.test(password) ? undefined : "invalidRule";
}
