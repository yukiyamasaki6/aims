"use client";

import { type RefObject, useEffect, useState } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import type { EmailOtp, EmailOtpView } from "../application/email-otp";
import { RESEND_COOLDOWN_SECONDS } from "../domain/auth-code";
import {
  type EmailOtpFlow,
  emailOtpReducer,
  initialEmailOtpFlow,
} from "../domain/email-otp-flow";
import { OtpCodeStep } from "./otp-code-step";
import { OtpEmailStep } from "./otp-email-step";
import type { TurnstileReset } from "./turnstile";
import { useAuthTexts } from "./use-auth-texts";
import { useCheckWait } from "./use-check-wait";
import { useScreenView } from "./use-screen-view";

export type EmailOtpCopy = {
  idPrefix: string;
  emailTitle: string;
};

type CheckedInput = { email: string; from?: string | null };

type StepProps = {
  procedure: EmailOtp;
  copy: EmailOtpCopy;
  flow: EmailOtpFlow;
  view: EmailOtpView;
  siteKey: string;
  run: (input: CheckedInput) => void;
  checkProps: ReturnType<typeof useCheckWait>["checkProps"];
};

export function EmailOtpForm({
  procedure,
  copy,
  siteKey,
  readReturnTo = () => null,
}: {
  procedure: EmailOtp;
  copy: EmailOtpCopy;
  siteKey: string;
  readReturnTo?: () => string | null;
}) {
  const {
    state: flow,
    view,
    checkRef: check,
  } = useScreenView(emailOtpReducer, initialEmailOtpFlow);
  const [email, setEmail] = useState("");
  const hydrated = useHydrated();
  const texts = useAuthTexts();
  const { dispatch } = view;
  const { run, checkProps } = useCheckWait({
    flow,
    dispatch,
    resume: (input: CheckedInput) => void procedure.sendCode(input, view),
  });
  useEffect(
    () =>
      flow.resendCooldown === 0 ? undefined : procedure.tickCooldown(dispatch),
    [flow.resendCooldown, procedure, dispatch],
  );
  const step = { procedure, copy, flow, view, siteKey, run, checkProps };

  if (flow.step === "code")
    return <CodeStep {...step} check={check} email={email} />;
  return (
    <OtpEmailStep
      idPrefix={copy.idPrefix}
      title={copy.emailTitle}
      email={email}
      onEmailChange={setEmail}
      emailError={texts.fieldError("email", flow.fieldErrors.email)}
      submitting={flow.pending === "send"}
      resendCooldown={flow.resendCooldown}
      resendError={texts.fieldError("resend", flow.fieldErrors.resend)}
      error={texts.screenError(flow.error, flow.fieldErrors.captcha)}
      hydrated={hydrated}
      siteKey={siteKey}
      onSubmit={(e) => {
        e.preventDefault();
        run({ email, from: readReturnTo() });
      }}
      checkRef={check}
      onCheck={(token) => view.dispatch({ type: "captchaChecked", token })}
      {...checkProps}
    />
  );
}

function CodeStep({
  procedure,
  copy,
  flow,
  view,
  siteKey,
  run,
  checkProps,
  check,
  email,
}: StepProps & {
  check: RefObject<TurnstileReset | undefined>;
  email: string;
}) {
  const texts = useAuthTexts();
  const [code, setCode] = useState("");
  useEffect(() => {
    if (flow.resendCooldown === RESEND_COOLDOWN_SECONDS) setCode("");
  }, [flow.resendCooldown]);
  const pending =
    flow.pending === "verify" || flow.pending === "send" ? flow.pending : null;
  return (
    <OtpCodeStep
      idPrefix={copy.idPrefix}
      email={email}
      code={code}
      onCodeChange={setCode}
      codeError={texts.fieldError("code", flow.fieldErrors.code)}
      resendError={texts.fieldError("resend", flow.fieldErrors.resend)}
      pending={pending}
      error={texts.screenError(flow.error, flow.fieldErrors.captcha)}
      onBack={() => view.dispatch({ type: "emailStepReturned" })}
      onVerify={(e) => {
        e.preventDefault();
        void procedure.verifyCode({ email, code }, view);
      }}
      onResend={() => {
        run({ email });
      }}
      siteKey={siteKey}
      checkRef={check}
      onCheck={(token) => view.dispatch({ type: "captchaChecked", token })}
      {...checkProps}
      resendCooldown={flow.resendCooldown}
    />
  );
}
