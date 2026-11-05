"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { useTranslations } from "next-intl";
import type { FormEvent, RefObject } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { Input } from "@/components/ui/input";
import { AUTH_CODE_LENGTH } from "../domain/auth-code";
import { AuthHeader } from "./auth-header";
import { Turnstile } from "./turnstile";

type Pending = "verify" | "resend" | null;

type OtpCodeStepProps = {
  email: string;
  code: string;
  onCodeChange: (value: string) => void;
  resendError: string | undefined;
  // 実行中の確認か再送。どちらかが実行中の間は、3つのボタンを無効にする。
  pending: Pending;
  error: string | null;
  onBack: () => void;
  onVerify: (e: FormEvent<HTMLFormElement>) => void;
  onResend: () => void;
  siteKey: string;
  checkRef: RefObject<TurnstileInstance | undefined>;
  onCheck: (token: string | null) => void;
  resendCooldown: number;
};

export function OtpCodeStep({
  email,
  code,
  onCodeChange,
  resendError,
  pending,
  error,
  onBack,
  onVerify,
  onResend,
  siteKey,
  checkRef,
  onCheck,
  resendCooldown,
}: OtpCodeStepProps) {
  const t = useTranslations("auth");
  return (
    <>
      <AuthHeader
        title={t("otpTitle")}
        description={t("otpDescription", { email })}
        onBack={onBack}
        backDisabled={pending !== null}
      />
      <CodeEntryForm
        code={code}
        onCodeChange={onCodeChange}
        pending={pending}
        onSubmit={onVerify}
      />
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      <p className="text-center text-muted-foreground text-sm">
        {t("otpSpamNote")}
      </p>
      <Turnstile siteKey={siteKey} ref={checkRef} onVerify={onCheck} />
      <ResendSection
        pending={pending}
        resendCooldown={resendCooldown}
        resendError={resendError}
        onResend={onResend}
      />
    </>
  );
}

function CodeEntryForm({
  code,
  onCodeChange,
  pending,
  onSubmit,
}: {
  code: string;
  onCodeChange: (value: string) => void;
  pending: Pending;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const t = useTranslations("auth");
  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-3">
      <Input
        type="text"
        inputMode="numeric"
        placeholder={t("otpCodePlaceholder")}
        className="text-center tracking-widest"
        maxLength={AUTH_CODE_LENGTH}
        value={code}
        onChange={(e) => onCodeChange(e.target.value)}
      />
      <BusyButton
        type="submit"
        busy={pending !== null}
        spinner={pending === "verify"}
      >
        {t("otpVerify")}
      </BusyButton>
    </form>
  );
}

function ResendSection({
  pending,
  resendCooldown,
  resendError,
  onResend,
}: {
  pending: Pending;
  resendCooldown: number;
  resendError: string | undefined;
  onResend: () => void;
}) {
  const t = useTranslations("auth");
  return (
    <div className="flex w-full flex-col items-center gap-1">
      <BusyButton
        type="button"
        variant="outline"
        className="w-full"
        busy={pending !== null}
        spinner={pending === "resend"}
        onClick={onResend}
      >
        {resendCooldown > 0
          ? t("otpResendWait", { seconds: String(resendCooldown) })
          : t("otpResend")}
      </BusyButton>
      {resendError && <p className="text-destructive text-sm">{resendError}</p>}
    </div>
  );
}
