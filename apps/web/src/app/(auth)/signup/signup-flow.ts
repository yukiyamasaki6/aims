import type { AuthError } from "@supabase/supabase-js";
import { translateAuthErrorMessage } from "@/lib/supabase/errors";
import type {
  SignUpCodeFieldErrors,
  SignUpEmailFieldErrors,
  SignUpPasswordFieldErrors,
} from "./validate";

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

export type SignUpState = {
  step: "email" | "code" | "password";
  error: string | null;
  emailFieldErrors: SignUpEmailFieldErrors & { captcha?: string };
  codeFieldErrors: SignUpCodeFieldErrors;
  passwordFieldErrors: SignUpPasswordFieldErrors;
  resendCooldown: number;
};

export const initialSignUpState: SignUpState = {
  step: "email",
  error: null,
  emailFieldErrors: {},
  codeFieldErrors: {},
  passwordFieldErrors: {},
  resendCooldown: 0,
};

export type SignUpAction =
  | { type: "reset_to_email" }
  | { type: "resend_tick" }
  | {
      type: "send_code_invalid";
      errors: SignUpEmailFieldErrors & { captcha?: string };
    }
  | { type: "send_code_started" }
  | { type: "send_code_already_registered" }
  | { type: "send_code_succeeded" }
  | { type: "send_code_auth_error"; error: AuthError }
  | { type: "send_code_network_error" }
  | { type: "verify_code_invalid"; errors: SignUpCodeFieldErrors }
  | { type: "verify_code_started" }
  | { type: "verify_code_succeeded" }
  | { type: "verify_code_auth_error"; error: AuthError }
  | { type: "verify_code_network_error" }
  | { type: "resend_invalid"; errors: SignUpCodeFieldErrors }
  | { type: "resend_started" }
  | { type: "resend_auth_error"; error: AuthError }
  | { type: "resend_network_error" }
  | { type: "set_password_invalid"; errors: SignUpPasswordFieldErrors }
  | { type: "set_password_started" }
  | { type: "set_password_auth_error"; error: AuthError }
  | { type: "set_password_network_error" };

export function signupReducer(
  state: SignUpState,
  action: SignUpAction,
): SignUpState {
  switch (action.type) {
    case "reset_to_email":
      return { ...state, step: "email", error: null, codeFieldErrors: {} };
    case "resend_tick":
      return { ...state, resendCooldown: state.resendCooldown - 1 };

    case "send_code_invalid":
      return { ...state, error: null, emailFieldErrors: action.errors };
    case "send_code_started":
      return { ...state, error: null, emailFieldErrors: {} };
    case "send_code_already_registered":
      return {
        ...state,
        error: "このメールアドレスは既に登録されています。",
        emailFieldErrors: {},
      };
    case "send_code_succeeded":
      return {
        ...state,
        error: null,
        emailFieldErrors: {},
        step: "code",
        resendCooldown: 60,
      };
    case "send_code_auth_error":
      return {
        ...state,
        error: translateAuthErrorMessage(action.error),
        emailFieldErrors: {},
      };
    case "send_code_network_error":
      return { ...state, error: NETWORK_ERROR_MESSAGE, emailFieldErrors: {} };

    case "verify_code_invalid":
      return { ...state, error: null, codeFieldErrors: action.errors };
    case "verify_code_started":
      return { ...state, error: null, codeFieldErrors: {} };
    case "verify_code_succeeded":
      return { ...state, error: null, codeFieldErrors: {}, step: "password" };
    case "verify_code_auth_error":
      return {
        ...state,
        error: translateAuthErrorMessage(action.error),
        codeFieldErrors: {},
      };
    case "verify_code_network_error":
      return { ...state, error: NETWORK_ERROR_MESSAGE, codeFieldErrors: {} };

    case "resend_invalid":
      return { ...state, error: null, codeFieldErrors: action.errors };
    case "resend_started":
      return {
        ...state,
        error: null,
        codeFieldErrors: {},
        resendCooldown: 60,
      };
    case "resend_auth_error":
      return { ...state, error: translateAuthErrorMessage(action.error) };
    case "resend_network_error":
      return { ...state, error: NETWORK_ERROR_MESSAGE };

    case "set_password_invalid":
      return { ...state, error: null, passwordFieldErrors: action.errors };
    case "set_password_started":
      return { ...state, error: null, passwordFieldErrors: {} };
    case "set_password_auth_error":
      return {
        ...state,
        error: translateAuthErrorMessage(action.error),
        passwordFieldErrors: {},
      };
    case "set_password_network_error":
      return {
        ...state,
        error: NETWORK_ERROR_MESSAGE,
        passwordFieldErrors: {},
      };
  }
}
