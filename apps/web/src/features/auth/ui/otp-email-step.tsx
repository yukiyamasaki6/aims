"use client";

import { useTranslations } from "next-intl";
import type { FormEvent, RefObject } from "react";
import { Input } from "@/components/ui/input";
import { AuthField } from "./auth-field";
import { AuthHeader } from "./auth-header";
import { OtpSendForm } from "./otp-send-form";
import type { TurnstileReset } from "./turnstile";

type OtpEmailStepProps = {
  // エラー文の要素のidの接頭辞(`${idPrefix}-email-error`)。
  idPrefix: string;
  title: string;
  email: string;
  onEmailChange: (value: string) => void;
  emailError: string | undefined;
  submitting: boolean;
  resendCooldown: number;
  resendError: string | undefined;
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
  resendCooldown,
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
  return (
    <>
      <AuthHeader title={title} />
      <OtpSendForm
        onSubmit={onSubmit}
        hydrated={hydrated}
        siteKey={siteKey}
        checkRef={checkRef}
        onCheck={onCheck}
        onFailed={onFailed}
        waiting={waiting}
        submitting={submitting}
        label={t("otpSendCode")}
        variant="default"
        resendCooldown={resendCooldown}
        resendError={resendError}
        error={error}
      >
        <AuthField errorId={`${idPrefix}-email-error`} error={emailError}>
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
      </OtpSendForm>
    </>
  );
}
