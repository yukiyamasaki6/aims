import { type AuthFailure, failureMessage } from "./auth-failure";
import {
  CAPTCHA_INCOMPLETE_MESSAGE,
  isCaptchaCompleted,
} from "./captcha-token";
import { validateEmail } from "./email-address";
import { validatePasswordPresent } from "./password-input";

// サインインの試み。送信の可否、入力の検証の順序、失敗の後の状態、セキュリティチェックのトークンの消費を守る集約。

export type FieldErrors = {
  readonly email?: string;
  readonly password?: string;
  readonly captcha?: string;
};

export type Credentials = {
  readonly email: string;
  readonly password: string;
  readonly captchaToken: string;
};

export type SignInAttempt = {
  readonly captchaToken: string | null;
  readonly submitting: boolean;
  readonly fieldErrors: FieldErrors;
  readonly error: string | null;
};

export const initialAttempt: SignInAttempt = {
  captchaToken: null,
  submitting: false,
  fieldErrors: {},
  error: null,
};

type Input = { email: string; password: string };

export type SignInAction =
  | { type: "verified"; token: string | null }
  | { type: "invalid"; fieldErrors: FieldErrors }
  | { type: "submitted" }
  | { type: "failed"; failure: AuthFailure };

export function signInReducer(
  attempt: SignInAttempt,
  action: SignInAction,
): SignInAttempt {
  switch (action.type) {
    case "verified":
      return { ...attempt, captchaToken: action.token };
    case "invalid":
      return { ...attempt, error: null, fieldErrors: action.fieldErrors };
    case "submitted":
      return { ...attempt, submitting: true, error: null, fieldErrors: {} };
    // 使ったトークンでは再送信できないため、消費する。画面のチェックのやり直しは、手続きが画面の約束で頼む。
    case "failed":
      return {
        ...attempt,
        submitting: false,
        error: failureMessage(action.failure),
        fieldErrors: {},
        captchaToken: null,
      };
  }
}

export type SignInCheck =
  | { readonly kind: "busy" }
  | { readonly kind: "invalid"; readonly fieldErrors: FieldErrors }
  | { readonly kind: "ready"; readonly credentials: Credentials };

// 送信できるかを、1回の評価で決める。送信中、入力の不備(メールアドレス、パスワード、チェックの順に最初の1件)、送信できる、のどれか。
export function checkSignIn(attempt: SignInAttempt, input: Input): SignInCheck {
  if (attempt.submitting) return { kind: "busy" };
  const email = validateEmail(input.email);
  if (email) return { kind: "invalid", fieldErrors: { email } };
  // 登録時のパスワードポリシーをサインインで課すと、ポリシー変更前に登録した正しいパスワードで入れなくなるため、空かどうかだけを見る。
  const password = validatePasswordPresent(input.password);
  if (password) return { kind: "invalid", fieldErrors: { password } };
  if (!isCaptchaCompleted(attempt.captchaToken)) {
    return {
      kind: "invalid",
      fieldErrors: { captcha: CAPTCHA_INCOMPLETE_MESSAGE },
    };
  }
  return {
    kind: "ready",
    credentials: { ...input, captchaToken: attempt.captchaToken },
  };
}
