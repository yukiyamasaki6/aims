"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { useTranslations } from "next-intl";
import type { FormEvent, ReactNode, RefObject } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { Input } from "@/components/ui/input";
import { AuthField } from "./auth-field";
import { AuthHeader } from "./auth-header";
import { Turnstile } from "./turnstile";

type OtpEmailStepProps = {
  // エラー文の要素のidの接頭辞(`${idPrefix}-email-error`)。
  idPrefix: string;
  title: string;
  // 全体のエラーの下に置く、サインインへのリンクなど。
  footer: ReactNode;
  email: string;
  onEmailChange: (value: string) => void;
  emailError: string | undefined;
  captchaError: string | undefined;
  submitting: boolean;
  error: string | null;
  hydrated: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  siteKey: string;
  checkRef: RefObject<TurnstileInstance | undefined>;
  onCheck: (token: string | null) => void;
};

export function OtpEmailStep({
  idPrefix,
  title,
  footer,
  email,
  onEmailChange,
  emailError,
  captchaError,
  submitting,
  error,
  hydrated,
  onSubmit,
  siteKey,
  checkRef,
  onCheck,
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
              placeholder={t("emailPlaceholder")}
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
          error={captchaError}
        />
        <BusyButton type="submit" busy={submitting}>
          {t("otpSendCode")}
        </BusyButton>
      </form>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      {footer}
    </>
  );
}
