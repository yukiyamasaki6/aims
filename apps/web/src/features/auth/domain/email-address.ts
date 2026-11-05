const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// メールアドレスの誤りの種類。required: 未入力。invalidFormat: 形式が正しくない。長さはサーバーに任せる。
export type EmailError = "required" | "invalidFormat";

// 正しければundefined、誤りなら誤りの種類を返す。
export function validateEmail(email: string): EmailError | undefined {
  if (!email) return "required";
  if (!EMAIL_PATTERN.test(email)) return "invalidFormat";
  return undefined;
}
