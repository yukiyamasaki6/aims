import { validateEmailField } from "../_shared/validate";

export type SignInFieldErrors = {
  email?: string;
  password?: string;
  captcha?: string;
};

export function validateSignInFields(
  email: string,
  password: string,
): SignInFieldErrors {
  const emailErrors = validateEmailField(email);
  if (emailErrors.email) {
    return { email: emailErrors.email };
  }
  // 登録時のパスワードポリシーをサインインで課すと、ポリシー変更前に登録した正しいパスワードで入れなくなるため、空チェックのみ行う。
  if (!password) {
    return { password: "パスワードを入力してください。" };
  }

  return {};
}
