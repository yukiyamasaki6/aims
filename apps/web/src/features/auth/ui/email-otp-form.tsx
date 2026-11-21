"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import type { EmailOtp } from "../application/email-otp";
import { emailOtpReducer, initialEmailOtpFlow } from "../domain/email-otp-flow";
import { FlowOtpCodeStep } from "./flow-otp-code-step";
import { OtpEmailStep } from "./otp-email-step";
import { useAuthTexts } from "./use-auth-texts";
import { useCheckWait } from "./use-check-wait";
import { useResendCooldownTick } from "./use-code-entry";
import { useScreenView } from "./use-screen-view";

type CheckedInput = { email: string; from?: string | null };

export function EmailOtpForm({
  procedure,
  idPrefix,
  siteKey,
  readReturnTo,
  emailStepLeading,
}: {
  procedure: EmailOtp;
  idPrefix: string;
  siteKey: string;
  readReturnTo: () => string | null;
  // メール入力の段階のフォームの上に差し込む部品(サインインのGoogleの操作)。コード入力の段階には出さない。
  emailStepLeading?: ReactNode;
}) {
  const screen = useScreenView(emailOtpReducer, initialEmailOtpFlow);
  const { state: flow, view, checkRef: check } = screen;
  const [email, setEmail] = useState("");
  const hydrated = useHydrated();
  const texts = useAuthTexts();
  const { dispatch } = view;
  const { run, checkProps } = useCheckWait({
    flow,
    dispatch,
    resume: (input: CheckedInput) => void procedure.sendCode(input, view),
  });
  useResendCooldownTick(flow.resendCooldown, procedure.tickCooldown, dispatch);
  const t = useTranslations("auth");

  if (flow.step === "code")
    return (
      <FlowOtpCodeStep
        idPrefix={idPrefix}
        email={email}
        screen={screen}
        siteKey={siteKey}
        checkProps={checkProps}
        verifyLabel={t("otpVerify")}
        verifyVariant="default"
        onVerify={(code) => void procedure.verifyCode({ email, code }, view)}
        onResend={() => run({ email })}
      />
    );
  return (
    <OtpEmailStep
      idPrefix={idPrefix}
      email={email}
      onEmailChange={setEmail}
      emailError={texts.fieldError("email", flow.fieldErrors.email)}
      submitting={flow.pending !== null}
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
      leading={emailStepLeading}
      {...checkProps}
    />
  );
}
