import {
  CAPTCHA_INCOMPLETE_MESSAGE,
  isCaptchaCompleted,
  validateEmail,
  validatePasswordPresent,
} from "@/features/auth";
import {
  OTP_CODE_LENGTH,
  PASSWORD_ALLOWED_PATTERN,
  PASSWORD_MAX_LENGTH,
} from "./auth-constants";
import { CODE_PATTERN } from "./otp-code-pattern";

export type EmailFieldErrors = {
  email?: string;
};

export function validateEmailField(email: string): EmailFieldErrors {
  const message = validateEmail(email);
  return message ? { email: message } : {};
}

export type CodeFieldErrors = {
  code?: string;
  resend?: string;
};

export function validateCodeField(code: string): CodeFieldErrors {
  if (!code) {
    return { code: "認証コードを入力してください。" };
  }
  if (!CODE_PATTERN.test(code)) {
    return {
      code: `認証コードは${OTP_CODE_LENGTH}桁の数字で入力してください。`,
    };
  }

  return {};
}

export function validateResendReady(
  resendCooldown: number,
  captchaToken: string | null,
): CodeFieldErrors {
  if (resendCooldown > 0) {
    return {
      resend: "再送はクールダウン中です。しばらくしてから再度お試しください。",
    };
  }
  if (!isCaptchaCompleted(captchaToken)) {
    return { resend: CAPTCHA_INCOMPLETE_MESSAGE };
  }

  return {};
}

export type PasswordFieldErrors = {
  password?: string;
};

export function validatePasswordField(password: string): PasswordFieldErrors {
  const missing = validatePasswordPresent(password);
  if (missing) {
    return { password: missing };
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
