import { type AuthFailure, failureMessage } from "./auth-failure";
import {
  CAPTCHA_INCOMPLETE_MESSAGE,
  isCaptchaCompleted,
} from "./captcha-token";
import { validateEmail } from "./email-address";
import type { FieldErrors, Start } from "./flow";
import { validatePasswordPresent } from "./password";

// サインインの流れ。開始の可否、入力の検証の順序、失敗の後の状態、セキュリティチェックのトークンの消費を守る集約。

export type SignInFlow = {
  readonly captchaToken: string | null;
  readonly submitting: boolean;
  readonly fieldErrors: FieldErrors<"email" | "password" | "captcha">;
  readonly error: string | null;
};

export const initialSignInFlow: SignInFlow = {
  captchaToken: null,
  submitting: false,
  fieldErrors: {},
  error: null,
};

export type Credentials = {
  readonly email: string;
  readonly password: string;
  readonly captchaToken: string;
};

// 開始の命令。送信中なら開始しない。入力の不備は、メールアドレス、パスワード、チェックの順に最初の1件を示す。開始できるなら送信中にする。
export function beginSignIn(
  flow: SignInFlow,
  input: { email: string; password: string },
): Start<SignInFlow, Credentials> {
  if (flow.submitting) return { kind: "busy", state: flow };
  const invalid = (fieldErrors: SignInFlow["fieldErrors"]) =>
    ({
      kind: "invalid",
      state: { ...flow, error: null, fieldErrors },
    }) as const;
  const email = validateEmail(input.email);
  if (email) return invalid({ email });
  // 登録時のパスワードポリシーをサインインで課すと、ポリシー変更前に登録した正しいパスワードで入れなくなるため、空かどうかだけを見る。
  const password = validatePasswordPresent(input.password);
  if (password) return invalid({ password });
  if (!isCaptchaCompleted(flow.captchaToken)) {
    return invalid({ captcha: CAPTCHA_INCOMPLETE_MESSAGE });
  }
  return {
    kind: "started",
    state: { ...flow, submitting: true, error: null, fieldErrors: {} },
    request: { ...input, captchaToken: flow.captchaToken },
  };
}

// 画面で起きた事実。開始の命令は含まない(beginSignIn)。
export type SignInEvent =
  | { type: "captchaChecked"; token: string | null }
  | { type: "failed"; failure: AuthFailure };

export function signInReducer(
  flow: SignInFlow,
  event: SignInEvent,
): SignInFlow {
  switch (event.type) {
    case "captchaChecked":
      return { ...flow, captchaToken: event.token };
    // 使ったトークンでは再送信できないため、消費する。画面のチェックのやり直しは、手続きが画面の約束で頼む。
    case "failed":
      return {
        ...flow,
        submitting: false,
        error: failureMessage(event.failure),
        fieldErrors: {},
        captchaToken: null,
      };
  }
}
