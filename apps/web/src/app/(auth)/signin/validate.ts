const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignInFieldErrors = {
  email?: string;
  password?: string;
  captcha?: string;
};

export function validateSignInFields(
  email: string,
  password: string,
): SignInFieldErrors {
  if (!email) {
    return { email: "メールアドレスを入力してください。" };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { email: "メールアドレスの形式が正しくありません。" };
  }
  if (!password) {
    return { password: "パスワードを入力してください。" };
  }

  return {};
}
