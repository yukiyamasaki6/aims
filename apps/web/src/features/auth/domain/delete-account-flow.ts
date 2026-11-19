import {
  beginSendCodeToCurrent,
  beginVerifyCode,
  type EmailOtpEvent,
  type EmailOtpFlow,
  emailOtpReducer,
  initialEmailOtpFlow,
} from "./email-otp-flow";
import type { Start } from "./flow";

// 共通のメール確認コードの流れに、送付先の利用者を加えたもの。段階は、意思確認(confirmation)とコード入力(code)。
export type DeleteAccountFlow = Omit<EmailOtpFlow, "step"> & {
  readonly step: "confirmation" | "code";
  readonly userId: string | null;
  readonly email: string;
};
export const initialDeleteAccountFlow: DeleteAccountFlow = {
  ...initialEmailOtpFlow,
  step: "confirmation",
  userId: null,
  email: "",
};
// codeSent: 送付先の利用者を伴う`codeSentTo`で置き換える。
// returnedWithFailure: コード確認に成功した後の失敗で、意思確認へ戻る。
export type DeleteAccountEvent =
  | Exclude<EmailOtpEvent, { type: "codeSent" }>
  | { type: "codeSentTo"; userId: string; email: string }
  | { type: "returnedWithFailure" };

function otpFlow(flow: DeleteAccountFlow): EmailOtpFlow {
  return { ...flow, step: flow.step === "code" ? "code" : "email" };
}

function fromOtp(
  flow: DeleteAccountFlow,
  next: EmailOtpFlow,
): DeleteAccountFlow {
  return {
    ...flow,
    ...next,
    step: next.step === "code" ? "code" : "confirmation",
  };
}

// known: 初回は送付先が未確定でnull。再送では、最初の送付先。
export function beginDeleteCodeSend(
  flow: DeleteAccountFlow,
  offline: boolean,
): Start<
  DeleteAccountFlow,
  {
    captchaToken: string;
    known: { userId: string; email: string } | null;
  }
> {
  const started = beginSendCodeToCurrent(otpFlow(flow), { offline });
  return {
    state: fromOtp(flow, started.state),
    request: started.request && {
      captchaToken: started.request.captchaToken,
      known:
        flow.userId === null
          ? null
          : { userId: flow.userId, email: flow.email },
    },
  };
}

export function beginDeleteCodeVerify(
  flow: DeleteAccountFlow,
  input: { code: string; offline: boolean },
): Start<DeleteAccountFlow, { userId: string; email: string; code: string }> {
  if (!flow.userId) return { state: flow, request: null };
  const started = beginVerifyCode(otpFlow(flow), {
    ...input,
    email: flow.email,
  });
  return {
    state: fromOtp(flow, started.state),
    request: started.request && { ...started.request, userId: flow.userId },
  };
}

export function deleteAccountReducer(
  flow: DeleteAccountFlow,
  event: DeleteAccountEvent,
): DeleteAccountFlow {
  switch (event.type) {
    case "returnedWithFailure":
      return {
        ...fromOtp(
          flow,
          emailOtpReducer(otpFlow({ ...flow, pending: null }), {
            type: "emailStepReturned",
          }),
        ),
        error: "other",
      };
    case "codeSentTo":
      return {
        ...fromOtp(flow, emailOtpReducer(otpFlow(flow), { type: "codeSent" })),
        userId: event.userId,
        email: event.email,
      };
    default:
      return fromOtp(flow, emailOtpReducer(otpFlow(flow), event));
  }
}
