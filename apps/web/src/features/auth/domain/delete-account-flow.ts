import type { AuthFailure } from "./auth-failure";
import {
  beginSendCode,
  beginVerifyCode,
  type EmailOtpEvent,
  type EmailOtpFlow,
  emailOtpReducer,
  initialEmailOtpFlow,
} from "./email-otp-flow";
import type { Start } from "./flow";

export type DeleteAccountFlow = Omit<EmailOtpFlow, "step" | "pending"> & {
  readonly step: "confirmation" | "request" | "code";
  readonly pending: "delete" | "send" | "verify" | null;
  readonly userId: string | null;
  readonly email: string;
  readonly submitting: boolean;
};
export const initialDeleteAccountFlow: DeleteAccountFlow = {
  ...initialEmailOtpFlow,
  step: "confirmation",
  userId: null,
  email: "",
  submitting: false,
};
export type DeleteAccountEvent =
  | EmailOtpEvent
  | { type: "otpRequired"; userId: string; email: string }
  | { type: "codeRequested"; userId: string; email: string }
  | { type: "deletionFailed"; failure: AuthFailure };

function otpFlow(flow: DeleteAccountFlow): EmailOtpFlow {
  return {
    ...flow,
    step: flow.step === "code" ? "code" : "email",
    pending: flow.pending === "delete" ? "verify" : flow.pending,
  };
}

export function beginDeleteAccount(
  flow: DeleteAccountFlow,
  input: { offline: boolean },
): Start<DeleteAccountFlow, true> {
  if (flow.pending !== null || flow.step !== "confirmation")
    return { state: flow, request: null };
  if (input.offline)
    return {
      state: { ...flow, error: "offline", fieldErrors: {} },
      request: null,
    };
  return {
    state: {
      ...flow,
      pending: "delete",
      submitting: true,
      error: null,
      fieldErrors: {},
    },
    request: true,
  };
}

export function beginDeleteCodeSend(
  flow: DeleteAccountFlow,
  offline: boolean,
): Start<
  DeleteAccountFlow,
  { userId: string; email: string; captchaToken: string }
> {
  if (!flow.userId || flow.step === "confirmation" || flow.pending === "delete")
    return { state: flow, request: null };
  const started = beginSendCode(otpFlow(flow), { email: flow.email, offline });
  return {
    state: {
      ...flow,
      ...started.state,
      step: flow.step,
      submitting: started.state.pending !== null,
    },
    request: started.request
      ? { ...started.request, userId: flow.userId }
      : null,
  };
}

export function beginDeleteCodeVerify(
  flow: DeleteAccountFlow,
  input: { code: string; offline: boolean },
): Start<DeleteAccountFlow, { userId: string; email: string; code: string }> {
  if (!flow.userId || flow.step !== "code" || flow.pending === "delete")
    return { state: flow, request: null };
  const started = beginVerifyCode(otpFlow(flow), {
    ...input,
    email: flow.email,
  });
  return {
    state: {
      ...flow,
      ...started.state,
      step: flow.step,
      submitting: started.state.pending !== null,
    },
    request: started.request
      ? { ...started.request, userId: flow.userId }
      : null,
  };
}

export function deleteAccountReducer(
  flow: DeleteAccountFlow,
  event: DeleteAccountEvent,
): DeleteAccountFlow {
  if (event.type === "otpRequired")
    return {
      ...flow,
      userId: null,
      email: "",
      step: "confirmation",
      pending: null,
      submitting: false,
      awaitingCheck: false,
      captchaToken: null,
      resendCooldown: 0,
      fieldErrors: {},
      error: "otp_required",
    };
  if (event.type === "codeRequested")
    return {
      ...flow,
      userId: event.userId,
      email: event.email,
      step: "request",
      pending: "send",
      submitting: true,
      awaitingCheck: true,
      captchaToken: null,
      fieldErrors: {},
      error: null,
    };
  if (event.type === "deletionFailed")
    return {
      ...flow,
      step: "confirmation",
      pending: null,
      submitting: false,
      awaitingCheck: false,
      captchaToken: null,
      error: event.failure.kind,
    };
  const next = emailOtpReducer(otpFlow(flow), event);
  const leaves =
    flow.step === "request" &&
    (event.type === "refused" ||
      event.type === "failed" ||
      event.type === "checkWaitReleased");
  const step =
    event.type === "codeSent" ? "code" : leaves ? "confirmation" : flow.step;
  return {
    ...flow,
    ...next,
    step,
    submitting: next.pending !== null,
  };
}
