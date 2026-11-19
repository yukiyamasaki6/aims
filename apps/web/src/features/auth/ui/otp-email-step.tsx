"use client";

import { useTranslations } from "next-intl";
import type { FormEvent, RefObject } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { Input } from "@/components/ui/input";
import { AuthField } from "./auth-field";
import { AuthHeader } from "./auth-header";
import { Turnstile, type TurnstileReset } from "./turnstile";

type OtpEmailStepProps = {
  // エラー文の要素のidの接頭辞(`${idPrefix}-email-error`)。
  idPrefix: string;
  title: string;
  email: string;
  onEmailChange: (value: string) => void;
  emailError: string | undefined;
  submitting: boolean;
  resendCooldown?: number;
  resendError?: string;
  error: string | null;
  hydrated: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  siteKey: string;
  checkRef: RefObject<TurnstileReset | undefined>;
  onCheck: (token: string | null) => void;
  onFailed: () => void;
  waiting: boolean;
};

export function OtpEmailStep({
  idPrefix,
  title,
  email,
  onEmailChange,
  emailError,
  submitting,
  resendCooldown = 0,
  resendError,
  error,
  hydrated,
  onSubmit,
  siteKey,
  checkRef,
  onCheck,
  onFailed,
  waiting,
}: OtpEmailStepProps) {
  const t = useTranslations("auth");
  const errorId = `${idPrefix}-email-error`;
  return (
    <>
      <AuthHeader title={title} />
      <form
        onSubmit={onSubmit}
        noValidate
        data-hydrated={hydrated}
        className="flex w-full flex-col gap-3"
      >
        <AuthField errorId={errorId} error={emailError}>
          {(aria) => (
            <Input
              type="email"
              name="email"
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              readOnly={submitting}
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              {...aria}
            />
          )}
        </AuthField>
        <Turnstile
          siteKey={siteKey}
          ref={checkRef}
          onVerify={onCheck}
          onFailed={onFailed}
          waiting={waiting}
        />
        <BusyButton type="submit" busy={submitting}>
          {resendCooldown > 0
            ? t("otpResendWait", { seconds: String(resendCooldown) })
            : t("otpSendCode")}
        </BusyButton>
        {resendError && (
          <p className="text-destructive text-sm">{resendError}</p>
        )}
      </form>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
    </>
  );
}
