import {
  decrementResendCooldown,
  RESEND_COOLDOWN_SECONDS,
  validateAuthCode,
  validateResendWait,
} from "./auth-code";
import type { AuthFailure, AuthFailureKind } from "./auth-failure";
import {
  applyCheckedToken,
  applyCheckWaitReleased,
  type CheckEvent,
  isCaptchaCompleted,
} from "./captcha-token";
import { validateEmail } from "./email-address";
import type { FieldErrors, Start } from "./flow";

type Operation = "send" | "verify";

export type EmailOtpFlow = {
  readonly step: "email" | "code";
  readonly captchaToken: string | null;
  readonly pending: Operation | null;
  readonly awaitingCheck: boolean;
  readonly resendCooldown: number;
  readonly fieldErrors: FieldErrors<"email" | "captcha" | "resend" | "code">;
  readonly error: AuthFailureKind | null;
};

export const initialEmailOtpFlow: EmailOtpFlow = {
  step: "email",
  captchaToken: null,
  pending: null,
  awaitingCheck: false,
  resendCooldown: 0,
  fieldErrors: {},
  error: null,
};

type FieldErrorSet = EmailOtpFlow["fieldErrors"];

type Checked<Request> =
  | { readonly ok: false; readonly fieldErrors: FieldErrorSet }
  | { readonly ok: true; readonly request: Request };

function begin<Request>(
  flow: EmailOtpFlow,
  operation: Operation,
  offline: boolean,
  requiresCheck: boolean,
  check: () => Checked<Request>,
): Start<EmailOtpFlow, Request> {
  const waiting = requiresCheck && !isCaptchaCompleted(flow.captchaToken);
  const resuming = flow.awaitingCheck && flow.pending === operation;
  if (flow.pending !== null && (!resuming || waiting)) {
    return { state: flow, request: null };
  }
  const idle = { ...flow, pending: null, awaitingCheck: false };
  const checked = check();
  if (!checked.ok) {
    return {
      state: {
        ...idle,
        error: null,
        fieldErrors: checked.fieldErrors,
      },
      request: null,
    };
  }
  if (offline) {
    return {
      state: { ...idle, error: "offline", fieldErrors: {} },
      request: null,
    };
  }
  const running = { ...idle, error: null, fieldErrors: {}, pending: operation };
  return waiting
    ? { state: { ...running, awaitingCheck: true }, request: null }
    : { state: running, request: checked.request };
}

export function beginSendCode(
  flow: EmailOtpFlow,
  input: { email: string; offline: boolean },
): Start<EmailOtpFlow, { email: string; captchaToken: string }> {
  return begin(flow, "send", input.offline, true, () => {
    const email = validateEmail(input.email);
    const wait = validateResendWait(flow.resendCooldown);
    if (email || wait) {
      return {
        ok: false,
        fieldErrors: { ...(email && { email }), ...(wait && { resend: wait }) },
      };
    }
    return {
      ok: true,
      request: { email: input.email, captchaToken: flow.captchaToken ?? "" },
    };
  });
}

// 送付先を入力で受けず、手続きが認証サービスから読む画面の送信の開始。再送待機とチェックは通常の送信と同じ。
export function beginSendCodeToCurrent(
  flow: EmailOtpFlow,
  input: { offline: boolean },
): Start<EmailOtpFlow, { captchaToken: string }> {
  return begin(flow, "send", input.offline, true, () => {
    const wait = validateResendWait(flow.resendCooldown);
    if (wait) return { ok: false, fieldErrors: { resend: wait } };
    return { ok: true, request: { captchaToken: flow.captchaToken ?? "" } };
  });
}

export function beginVerifyCode(
  flow: EmailOtpFlow,
  input: { email: string; code: string; offline: boolean },
): Start<EmailOtpFlow, { email: string; code: string }> {
  return begin(flow, "verify", input.offline, false, () => {
    const code = validateAuthCode(input.code);
    if (code) return { ok: false, fieldErrors: { code } };
    return { ok: true, request: { email: input.email, code: input.code } };
  });
}

export type EmailOtpEvent =
  | { type: "captchaChecked"; token: string | null }
  | CheckEvent
  | { type: "cooldownTicked" }
  | { type: "emailStepReturned" }
  | { type: "codeSent" }
  | { type: "failed"; failure: AuthFailure }
  | { type: "refused"; failure: AuthFailure };

export function emailOtpReducer(
  flow: EmailOtpFlow,
  event: EmailOtpEvent,
): EmailOtpFlow {
  switch (event.type) {
    case "captchaChecked":
      return applyCheckedToken(flow, event.token);
    case "checkWaitReleased":
      return applyCheckWaitReleased(flow, { pending: null });
    case "cooldownTicked":
      return {
        ...flow,
        resendCooldown: decrementResendCooldown(flow.resendCooldown),
      };
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
    default:
      return settle(flow, event);
  }
}

type Settlement = Extract<
  EmailOtpEvent,
  { type: "codeSent" | "failed" | "refused" }
>;

function settle(flow: EmailOtpFlow, event: Settlement): EmailOtpFlow {
  switch (event.type) {
    case "codeSent":
      return {
        ...flow,
        step: "code",
        captchaToken: null,
        pending: null,
        resendCooldown: RESEND_COOLDOWN_SECONDS,
      };
    case "failed":
      return {
        ...flow,
        pending: null,
        error: event.failure.kind,
      };
    case "refused":
      return {
        ...settle(flow, { type: "failed", failure: event.failure }),
        captchaToken: null,
      };
  }
}
