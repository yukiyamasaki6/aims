import { validateAuthCode } from "../domain/auth-code";
import {
  CAPTCHA_INCOMPLETE_MESSAGE,
  isCaptchaCompleted,
} from "../domain/captcha-token";
import { validateEmail } from "../domain/email-address";
import { validateNewPassword } from "../domain/new-password";
import { validateResendWait } from "../domain/resend-wait";

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
  const message = validateAuthCode(code);
  return message ? { code: message } : {};
}

export function validateResendReady(
  resendCooldown: number,
  captchaToken: string | null,
): CodeFieldErrors {
  const wait = validateResendWait(resendCooldown);
  if (wait) return { resend: wait };
  if (!isCaptchaCompleted(captchaToken)) {
    return { resend: CAPTCHA_INCOMPLETE_MESSAGE };
  }

  return {};
}

export type PasswordFieldErrors = {
  password?: string;
};

export function validatePasswordField(password: string): PasswordFieldErrors {
  const message = validateNewPassword(password);
  return message ? { password: message } : {};
}
