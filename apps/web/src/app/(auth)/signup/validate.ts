const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignUpEmailFieldErrors = {
  email?: string;
};

export function validateEmailField(email: string): SignUpEmailFieldErrors {
  if (!email) {
    return { email: "メールアドレスを入力してください。" };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { email: "メールアドレスの形式が正しくありません。" };
  }

  return {};
}

export type SignUpPasswordFieldErrors = {
  password?: string;
};

export function validatePasswordField(
  password: string,
): SignUpPasswordFieldErrors {
  if (!password) {
    return { password: "パスワードを入力してください。" };
  }
  if (
    password.length < 8 ||
    !/[a-zA-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return {
      password: "パスワードは8文字以上で、英字と数字の両方を含めてください。",
    };
  }

  return {};
}
