import {
  PASSWORD_ALLOWED_PATTERN,
  PASSWORD_MAX_LENGTH,
} from "../auth-constants";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ResetPasswordEmailFieldErrors = {
  email?: string;
};

export function validateEmailField(
  email: string,
): ResetPasswordEmailFieldErrors {
  if (!email) {
    return { email: "メールアドレスを入力してください。" };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { email: "メールアドレスの形式が正しくありません。" };
  }

  return {};
}

export type ResetPasswordCodeFieldErrors = {
  code?: string;
  resend?: string;
};

export function validateCodeField(code: string): ResetPasswordCodeFieldErrors {
  if (!code) {
    return { code: "認証コードを入力してください。" };
  }

  return {};
}

export function validateResendReady(
  resendCooldown: number,
  captchaToken: string | null,
): ResetPasswordCodeFieldErrors {
  if (resendCooldown > 0) {
    return {
      resend: "再送はクールダウン中です。しばらくしてから再度お試しください。",
    };
  }
  if (!captchaToken) {
    return { resend: "セキュリティチェックが完了していません。" };
  }

  return {};
}

export type ResetPasswordPasswordFieldErrors = {
  password?: string;
};

export function validatePasswordField(
  password: string,
): ResetPasswordPasswordFieldErrors {
  if (!password) {
    return { password: "パスワードを入力してください。" };
  }
  if (
    password.length < 8 ||
    password.length > PASSWORD_MAX_LENGTH ||
    !PASSWORD_ALLOWED_PATTERN.test(password) ||
    !/[a-zA-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return {
      password: `パスワードは8文字以上${PASSWORD_MAX_LENGTH}文字以内の半角英数記号で、英字と数字の両方を含めてください。`,
    };
  }

  return {};
}
