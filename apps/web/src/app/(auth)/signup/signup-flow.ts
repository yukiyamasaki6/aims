import type { AuthError } from "@supabase/supabase-js";
import { translateAuthErrorMessage } from "@/features/auth/errors";
import { NETWORK_ERROR_MESSAGE } from "../_shared/auth-constants";
import type {
  CodeFieldErrors,
  EmailFieldErrors,
  PasswordFieldErrors,
} from "../_shared/validate";

export type SignUpState = {
  step: "email" | "code" | "password";
  error: string | null;
  emailFieldErrors: EmailFieldErrors & { captcha?: string };
  codeFieldErrors: CodeFieldErrors;
  passwordFieldErrors: PasswordFieldErrors;
  resendCooldown: number;
  codeStepPending: "verify" | "resend" | null;
};

export const initialSignUpState: SignUpState = {
  step: "email",
  error: null,
  emailFieldErrors: {},
  codeFieldErrors: {},
  passwordFieldErrors: {},
  resendCooldown: 0,
  codeStepPending: null,
};

type CommonAction = { type: "reset_to_email" } | { type: "resend_tick" };

type SendCodeAction =
  | {
      type: "send_code_invalid";
      errors: EmailFieldErrors & { captcha?: string };
    }
  | { type: "send_code_started" }
  | { type: "send_code_already_registered" }
  | { type: "send_code_succeeded" }
  | { type: "send_code_auth_error"; error: AuthError }
  | { type: "send_code_network_error" };

type VerifyCodeAction =
  | { type: "verify_code_invalid"; errors: CodeFieldErrors }
  | { type: "verify_code_started" }
  | { type: "verify_code_succeeded" }
  | { type: "verify_code_auth_error"; error: AuthError }
  | { type: "verify_code_network_error" };

type ResendAction =
  | { type: "resend_invalid"; errors: CodeFieldErrors }
  | { type: "resend_started" }
  | { type: "resend_succeeded" }
  | { type: "resend_auth_error"; error: AuthError }
  | { type: "resend_network_error" };

type SetPasswordAction =
  | { type: "set_password_invalid"; errors: PasswordFieldErrors }
  | { type: "set_password_started" }
  | { type: "set_password_auth_error"; error: AuthError }
  | { type: "set_password_network_error" };

export type SignUpAction =
  | CommonAction
  | SendCodeAction
  | VerifyCodeAction
  | ResendAction
  | SetPasswordAction;

// 画面の段階ごとの下位のreducerへ振り分ける。
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
    case "send_code_started":
    case "send_code_already_registered":
    case "send_code_succeeded":
    case "send_code_auth_error":
    case "send_code_network_error":
      return sendCodeReducer(state, action);

    case "verify_code_invalid":
    case "verify_code_started":
    case "verify_code_succeeded":
    case "verify_code_auth_error":
    case "verify_code_network_error":
      return verifyCodeReducer(state, action);

    case "resend_invalid":
    case "resend_started":
    case "resend_succeeded":
    case "resend_auth_error":
    case "resend_network_error":
      return resendReducer(state, action);

    case "set_password_invalid":
    case "set_password_started":
    case "set_password_auth_error":
    case "set_password_network_error":
      return setPasswordReducer(state, action);
  }
}

function sendCodeReducer(
  state: SignUpState,
  action: SendCodeAction,
): SignUpState {
  switch (action.type) {
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
  }
}

function verifyCodeReducer(
  state: SignUpState,
  action: VerifyCodeAction,
): SignUpState {
  switch (action.type) {
    case "verify_code_invalid":
      return { ...state, error: null, codeFieldErrors: action.errors };
    case "verify_code_started":
      return {
        ...state,
        error: null,
        codeFieldErrors: {},
        codeStepPending: "verify",
      };
    case "verify_code_succeeded":
      return {
        ...state,
        error: null,
        codeFieldErrors: {},
        step: "password",
        codeStepPending: null,
      };
    case "verify_code_auth_error":
      return {
        ...state,
        error: translateAuthErrorMessage(action.error),
        codeFieldErrors: {},
        codeStepPending: null,
      };
    case "verify_code_network_error":
      return {
        ...state,
        error: NETWORK_ERROR_MESSAGE,
        codeFieldErrors: {},
        codeStepPending: null,
      };
  }
}

function resendReducer(state: SignUpState, action: ResendAction): SignUpState {
  switch (action.type) {
    case "resend_invalid":
      return { ...state, error: null, codeFieldErrors: action.errors };
    case "resend_started":
      return {
        ...state,
        error: null,
        codeFieldErrors: {},
        resendCooldown: 60,
        codeStepPending: "resend",
      };
    case "resend_succeeded":
      return { ...state, codeStepPending: null };
    case "resend_auth_error":
      return {
        ...state,
        error: translateAuthErrorMessage(action.error),
        codeStepPending: null,
      };
    case "resend_network_error":
      return { ...state, error: NETWORK_ERROR_MESSAGE, codeStepPending: null };
  }
}

function setPasswordReducer(
  state: SignUpState,
  action: SetPasswordAction,
): SignUpState {
  switch (action.type) {
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
