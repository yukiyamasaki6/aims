import type { AuthFailure, AuthFailureKind } from "./auth-failure";
import {
  applyCheckedToken,
  applyCheckWaitReleased,
  type CheckEvent,
  isCaptchaCompleted,
} from "./captcha-token";
import { validateEmail } from "./email-address";
import type { FieldErrors, Start } from "./flow";
import { validatePasswordPresent } from "./password";

// サインインの流れ。開始の可否、入力の検証の順序、失敗の後の状態、セキュリティチェックのトークンの消費を守る集約。

export type SignInFlow = {
  readonly captchaToken: string | null;
  readonly submitting: boolean;
  // チェック未完了のまま押され、トークンを待っている(送信中のまま)。
  readonly awaitingCheck: boolean;
  readonly fieldErrors: FieldErrors<"email" | "password" | "captcha">;
  readonly error: AuthFailureKind | null;
};

export const initialSignInFlow: SignInFlow = {
  captchaToken: null,
  submitting: false,
  awaitingCheck: false,
  fieldErrors: {},
  error: null,
};

export type Credentials = {
  readonly email: string;
  readonly password: string;
  readonly captchaToken: string;
};

// 開始の命令。判定の順序は、実行中(待ち以外) → 入力の判定 → オフラインの判定 → チェックの判定。
// 実行中(待ち以外)なら開始しない。待ちの間は、トークンが無い再押下では何も変えず、トークンが届いた後の開始は通常の開始と同じに進む。
// 入力の不備は、メールアドレスとパスワードを全て示す。
// 入力に不備が無くオフラインなら、通信もトークンの消費もせず、オフラインを示す(チェックの状態によらず、待たない)。
// 入力に不備もオフラインも無いとき、チェックが完了なら送信中にして依頼を返し、未完了(失敗の後を含む)なら依頼を返さず送信中の待ちにする。
// 開始では以前のエラーを消す。
// 送信中の間はエラーを持たない。
export function beginSignIn(
  flow: SignInFlow,
  input: { email: string; password: string; offline: boolean },
): Start<SignInFlow, Credentials> {
  const { captchaToken } = flow;
  if (
    flow.submitting &&
    (!flow.awaitingCheck || !isCaptchaCompleted(captchaToken))
  ) {
    return { state: flow, request: null };
  }
  const idle = { ...flow, submitting: false, awaitingCheck: false };
  const email = validateEmail(input.email);
  // 登録時のパスワードポリシーをサインインで課すと、ポリシー変更前に登録した正しいパスワードで入れなくなるため、空かどうかだけを見る。
  const password = validatePasswordPresent(input.password);
  if (email || password) {
    const fieldErrors: SignInFlow["fieldErrors"] = {
      ...(email && { email }),
      ...(password && { password }),
    };
    return {
      state: { ...idle, error: null, fieldErrors },
      request: null,
    };
  }
  if (input.offline) {
    return {
      state: { ...idle, error: "offline", fieldErrors: {} },
      request: null,
    };
  }
  const running = { ...idle, submitting: true, error: null, fieldErrors: {} };
  if (!isCaptchaCompleted(captchaToken)) {
    return { state: { ...running, awaitingCheck: true }, request: null };
  }
  return {
    state: running,
    request: { email: input.email, password: input.password, captchaToken },
  };
}

// 画面で起きた事実。開始の命令は含まない(beginSignIn)。
// checkWaitReleased: チェックの部品の失敗、または待ちの上限(`captcha-token.ts`)。待ちの間だけ待ちを解いてチェックのエラーを示す。
// failed: 照合の失敗(拒否も、通信の断も)。使ったトークンでは再送信できないため、全て消費する。
// 実行中は`error`・`fieldErrors`が空であることを前提とする(`beginSignIn`が開始で空にし、実行中に変えるのは結果だけ)。
export type SignInEvent =
  | { type: "captchaChecked"; token: string | null }
  | CheckEvent
  | { type: "failed"; failure: AuthFailure };

export function signInReducer(
  flow: SignInFlow,
  event: SignInEvent,
): SignInFlow {
  switch (event.type) {
    case "captchaChecked":
      return applyCheckedToken(flow, event.token);
    case "checkWaitReleased":
      return applyCheckWaitReleased(flow, { submitting: false });
    // 画面のチェックのやり直しは、手続きが画面の約束で頼む。
    case "failed":
      return {
        ...flow,
        submitting: false,
        awaitingCheck: false,
        captchaToken: null,
        error: event.failure.kind,
      };
  }
}
