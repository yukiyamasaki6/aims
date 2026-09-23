import { EMAIL_MAX_LENGTH } from "../auth-constants";

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
  // UIのmaxLength属性はブラウザ側の制限に過ぎず、devtools操作等で回避され得るため、アプリケーション層でも上限を検証する。
  if (email.length > EMAIL_MAX_LENGTH) {
    return {
      email: `メールアドレスは${EMAIL_MAX_LENGTH}文字以内で入力してください。`,
    };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { email: "メールアドレスの形式が正しくありません。" };
  }
  // 登録時のパスワードポリシーをサインインで課すと、ポリシー変更前に登録した正しいパスワードで入れなくなるため、空チェックのみ行う。
  if (!password) {
    return { password: "パスワードを入力してください。" };
  }

  return {};
}
