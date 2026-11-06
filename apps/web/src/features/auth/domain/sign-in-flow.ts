import type { AuthFailure, AuthFailureKind } from "./auth-failure";
import { isCaptchaCompleted } from "./captcha-token";
import { validateEmail } from "./email-address";
import type { FieldErrors, Start } from "./flow";
import { validatePasswordPresent } from "./password";

// サインインの流れ。開始の可否、入力の検証の順序、失敗の後の状態、セキュリティチェックのトークンの消費を守る集約。

export type SignInFlow = {
  readonly captchaToken: string | null;
  readonly submitting: boolean;
  readonly fieldErrors: FieldErrors<"email" | "password" | "captcha">;
  readonly error: AuthFailureKind | null;
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

// 開始の命令。判定の順序は、送信中 → 入力の判定 → オフラインの判定 → チェックの判定。
// 送信中なら開始しない。入力の不備は、メールアドレス、パスワードと、オンラインのときのチェック未完了を全て示す。
// 入力に不備が無くオフラインなら、通信もトークンの消費もせず、オフラインを示す(チェック未完了はオフラインでは示さない。原因を取り違えるため)。
// 開始できるなら送信中にする。開始では以前のエラーを消す。
export function beginSignIn(
  flow: SignInFlow,
  input: { email: string; password: string; offline: boolean },
): Start<SignInFlow, Credentials> {
  if (flow.submitting) return { state: flow, request: null };
  const email = validateEmail(input.email);
  // 登録時のパスワードポリシーをサインインで課すと、ポリシー変更前に登録した正しいパスワードで入れなくなるため、空かどうかだけを見る。
  const password = validatePasswordPresent(input.password);
  const { captchaToken } = flow;
  const inputErrors: SignInFlow["fieldErrors"] = {
    ...(email && { email }),
    ...(password && { password }),
  };
  if (input.offline) {
    return email || password
      ? {
          state: { ...flow, error: null, fieldErrors: inputErrors },
          request: null,
        }
      : {
          state: { ...flow, error: "offline", fieldErrors: {} },
          request: null,
        };
  }
  if (email || password || !isCaptchaCompleted(captchaToken)) {
    const fieldErrors: SignInFlow["fieldErrors"] = {
      ...inputErrors,
      ...(!isCaptchaCompleted(captchaToken) && { captcha: "incomplete" }),
    };
    return {
      state: { ...flow, error: null, fieldErrors },
      request: null,
    };
  }
  return {
    state: { ...flow, submitting: true, error: null, fieldErrors: {} },
    request: { email: input.email, password: input.password, captchaToken },
  };
}

// 画面で起きた事実。開始の命令は含まない(beginSignIn)。
// failed: 照合の失敗(拒否も、通信の断も)。使ったトークンでは再送信できないため、全て消費する。
// signedIn: 照合が受け付けられた。遷移の前に以前のエラーを消す。送信中は解除しない。
export type SignInEvent =
  | { type: "captchaChecked"; token: string | null }
  | { type: "signedIn" }
  | { type: "failed"; failure: AuthFailure };

export function signInReducer(
  flow: SignInFlow,
  event: SignInEvent,
): SignInFlow {
  switch (event.type) {
    case "captchaChecked":
      return { ...flow, captchaToken: event.token };
    case "signedIn":
      return { ...flow, error: null, fieldErrors: {} };
    // 画面のチェックのやり直しは、手続きが画面の約束で頼む。
    case "failed":
      return {
        ...flow,
        submitting: false,
        captchaToken: null,
        error: event.failure.kind,
        fieldErrors: {},
      };
  }
}
