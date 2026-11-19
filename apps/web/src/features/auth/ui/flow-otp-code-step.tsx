"use client";

import type { RefObject } from "react";
import type { EmailOtpFlow } from "../domain/email-otp-flow";
import { OtpCodeStep } from "./otp-code-step";
import type { TurnstileReset } from "./turnstile";
import { useAuthTexts } from "./use-auth-texts";
import type { useCheckWait } from "./use-check-wait";
import { useCodeInput } from "./use-code-entry";

// メール確認コードの流れの状態から、コード入力の段階を組む。コードの入力値は、この部品が持つ。
// screen: 画面の状態と約束(useScreenViewの結果のうち、この部品が使う部分)。
export function FlowOtpCodeStep({
  idPrefix,
  email,
  screen: { state: flow, view, checkRef },
  siteKey,
  checkProps,
  verifyLabel,
  verifyVariant,
  onVerify,
  onResend,
}: {
  idPrefix: string;
  email: string;
  screen: {
    state: Pick<
      EmailOtpFlow,
      "fieldErrors" | "pending" | "error" | "resendCooldown"
    >;
    view: {
      dispatch(
        event:
          | { type: "captchaChecked"; token: string | null }
          | { type: "emailStepReturned" },
      ): void;
    };
    checkRef: RefObject<TurnstileReset | undefined>;
  };
  siteKey: string;
  checkProps: ReturnType<typeof useCheckWait>["checkProps"];
  verifyLabel: string;
  verifyVariant: "default" | "destructive";
  onVerify: (code: string) => void;
  onResend: () => void;
}) {
  const texts = useAuthTexts();
  const [code, setCode] = useCodeInput(flow.resendCooldown);
  return (
    <OtpCodeStep
      idPrefix={idPrefix}
      email={email}
      code={code}
      onCodeChange={setCode}
      codeError={texts.fieldError("code", flow.fieldErrors.code)}
      resendError={texts.fieldError("resend", flow.fieldErrors.resend)}
      pending={flow.pending}
      error={texts.screenError(flow.error, flow.fieldErrors.captcha)}
      onBack={() => view.dispatch({ type: "emailStepReturned" })}
      verifyLabel={verifyLabel}
      verifyVariant={verifyVariant}
      onVerify={(e) => {
        e.preventDefault();
        onVerify(code);
      }}
      onResend={onResend}
      siteKey={siteKey}
      checkRef={checkRef}
      onCheck={(token) => view.dispatch({ type: "captchaChecked", token })}
      {...checkProps}
      resendCooldown={flow.resendCooldown}
    />
  );
}
