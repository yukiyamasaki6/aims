import {
  RESEND_COOLDOWN_SECONDS,
  validateAuthCode,
  validateResendWait,
} from "./auth-code";
import { type AuthFailure, failureMessage } from "./auth-failure";
import {
  CAPTCHA_INCOMPLETE_MESSAGE,
  isCaptchaCompleted,
} from "./captcha-token";
import { validateEmail } from "./email-address";
import type { FieldErrors, Start } from "./flow";
import { validateNewPassword } from "./password";

// 認証コードで本人確認をして、パスワードを設定する流れ(登録時と再設定時で同じ規則)。
// 段階、実行中の操作、再送の待ち時間、セキュリティチェックのトークンと、
// 操作の開始の可否と入力の検証の順序、失敗の後の状態、トークンの消費を守る集約。

type Operation = "send" | "verify" | "resend" | "setPassword";

export type PasswordSetupFlow = {
  readonly step: "email" | "code" | "password";
  readonly captchaToken: string | null;
  readonly pending: Operation | null;
  readonly resendCooldown: number;
  readonly fieldErrors: FieldErrors<
    "email" | "captcha" | "code" | "resend" | "password"
  >;
  readonly error: string | null;
};

export const initialPasswordSetupFlow: PasswordSetupFlow = {
  step: "email",
  captchaToken: null,
  pending: null,
  resendCooldown: 0,
  fieldErrors: {},
  error: null,
};

type FieldErrorSet = PasswordSetupFlow["fieldErrors"];

// 入力の検証の結果。不備があれば欄ごとのエラー、無ければ認証サービスへ頼む内容。
type Checked<Request> =
  | { readonly ok: false; readonly fieldErrors: FieldErrorSet }
  | { readonly ok: true; readonly request: Request };

// 開始の命令。実行中の操作が無く、操作の段階にあるときだけ開始できる(busy)。
// 入力の不備は、操作ごとの順序で最初の1件を示す(invalid)。開始できるなら、その操作を実行中にする(started)。
// 開始では以前のエラーを消さない。エラーは次の結果で変わる(4操作で同じ)。
function begin<Request>(
  flow: PasswordSetupFlow,
  operation: Operation,
  step: PasswordSetupFlow["step"],
  check: () => Checked<Request>,
): Start<PasswordSetupFlow, Request> {
  if (flow.pending !== null || flow.step !== step) {
    return { kind: "busy", state: flow };
  }
  const checked = check();
  if (!checked.ok) {
    return {
      kind: "invalid",
      state: { ...flow, error: null, fieldErrors: checked.fieldErrors },
    };
  }
  return {
    kind: "started",
    state: {
      ...flow,
      pending: operation,
      resendCooldown:
        operation === "resend" ? RESEND_COOLDOWN_SECONDS : flow.resendCooldown,
    },
    request: checked.request,
  };
}

// コードの送信。メールアドレス、セキュリティチェックの順に不備が無ければ送れる。
export function beginSendCode(
  flow: PasswordSetupFlow,
  input: { email: string },
): Start<PasswordSetupFlow, { email: string; captchaToken: string }> {
  return begin(flow, "send", "email", () => {
    const email = validateEmail(input.email);
    if (email) return { ok: false, fieldErrors: { email } };
    if (!isCaptchaCompleted(flow.captchaToken)) {
      return {
        ok: false,
        fieldErrors: { captcha: CAPTCHA_INCOMPLETE_MESSAGE },
      };
    }
    return {
      ok: true,
      request: { email: input.email, captchaToken: flow.captchaToken },
    };
  });
}

export function beginVerifyCode(
  flow: PasswordSetupFlow,
  input: { email: string; code: string },
): Start<PasswordSetupFlow, { email: string; code: string }> {
  return begin(flow, "verify", "code", () => {
    const code = validateAuthCode(input.code);
    if (code) return { ok: false, fieldErrors: { code } };
    return { ok: true, request: { email: input.email, code: input.code } };
  });
}

// コードの再送。待ち時間、セキュリティチェックの順に不備が無ければ送れる。
export function beginResend(
  flow: PasswordSetupFlow,
  input: { email: string },
): Start<PasswordSetupFlow, { email: string; captchaToken: string }> {
  return begin(flow, "resend", "code", () => {
    const wait = validateResendWait(flow.resendCooldown);
    if (wait) return { ok: false, fieldErrors: { resend: wait } };
    if (!isCaptchaCompleted(flow.captchaToken)) {
      return { ok: false, fieldErrors: { resend: CAPTCHA_INCOMPLETE_MESSAGE } };
    }
    return {
      ok: true,
      request: { email: input.email, captchaToken: flow.captchaToken },
    };
  });
}

export function beginSetPassword(
  flow: PasswordSetupFlow,
  input: { password: string },
): Start<PasswordSetupFlow, { password: string }> {
  return begin(flow, "setPassword", "password", () => {
    const password = validateNewPassword(input.password);
    if (password) return { ok: false, fieldErrors: { password } };
    return { ok: true, request: { password: input.password } };
  });
}

// 画面で起きた事実。開始の命令は含まない(begin*)。
export type PasswordSetupEvent =
  | { type: "captchaChecked"; token: string | null }
  | { type: "cooldownTicked" }
  | { type: "emailStepReturned" }
  | { type: "codeSent" }
  | { type: "codeResent" }
  | { type: "codeConfirmed" }
  | { type: "passwordSet" }
  | { type: "failed"; failure: AuthFailure }
  | { type: "refused"; failure: AuthFailure };

export function passwordSetupReducer(
  flow: PasswordSetupFlow,
  event: PasswordSetupEvent,
): PasswordSetupFlow {
  switch (event.type) {
    case "captchaChecked":
      return { ...flow, captchaToken: event.token };
    case "cooldownTicked":
      return { ...flow, resendCooldown: flow.resendCooldown - 1 };
    // 確認と再送の応答待ちに戻ると、遅れて届いた応答が別の段階へ反映されるため、操作中は戻らない。
    case "emailStepReturned":
      return flow.pending !== null
        ? flow
        : {
            ...flow,
            step: "email",
            captchaToken: null,
            error: null,
            fieldErrors: {},
          };
    // パスワード設定の成功。遷移の前に以前のエラーを消す。実行中は解除しない(遷移までの二重設定を防ぐ)。
    case "passwordSet":
      return { ...flow, error: null, fieldErrors: {} };
    default:
      return settle(flow, event);
  }
}

type Settlement = Extract<
  PasswordSetupEvent,
  { type: "codeSent" | "codeResent" | "codeConfirmed" | "failed" | "refused" }
>;

// 操作の結果。実行中を解除し、結果を反映する。成功は以前のエラーを消し、失敗は理由に差し替える。
// セキュリティチェックのトークンは、認証サービスが応答すれば(コードの送信と再送の成功も、拒否も)使ったため消費する。応答が無かった失敗(failed)は、使っていないので消費しない。
function settle(flow: PasswordSetupFlow, event: Settlement): PasswordSetupFlow {
  switch (event.type) {
    case "codeSent":
      return {
        ...flow,
        step: "code",
        captchaToken: null,
        pending: null,
        error: null,
        fieldErrors: {},
        resendCooldown: RESEND_COOLDOWN_SECONDS,
      };
    case "codeResent":
      return {
        ...flow,
        captchaToken: null,
        pending: null,
        error: null,
        fieldErrors: {},
      };
    case "codeConfirmed":
      return {
        ...flow,
        step: "password",
        pending: null,
        error: null,
        fieldErrors: {},
      };
    case "failed":
      return {
        ...flow,
        pending: null,
        error: failureMessage(event.failure),
        fieldErrors: {},
      };
    case "refused":
      return {
        ...settle(flow, { type: "failed", failure: event.failure }),
        captchaToken: null,
      };
  }
}
