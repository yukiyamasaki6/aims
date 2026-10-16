"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { Loader2 } from "lucide-react";
import type { FormEvent, ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EMAIL_MAX_LENGTH } from "./auth-constants";
import { AuthHeader } from "./auth-header";
import { Turnstile } from "./turnstile";
import type { EmailFieldErrors } from "./validate";

// 部品が使う項目だけを構造で定める。各画面のフォームの状態はこの形を満たす。
export type OtpEmailStepModel = {
  email: string;
  setEmail: (value: string) => void;
  emailFieldErrors: EmailFieldErrors & { captcha?: string };
  primarySubmitting: boolean;
  error: string | null;
  hydrated: boolean;
  handleSendCode: (e: FormEvent<HTMLFormElement>) => void;
  turnstileRef: RefObject<TurnstileInstance | undefined>;
  setCaptchaToken: (token: string | null) => void;
  captchaToken: string | null;
};

export function OtpEmailStep({
  form,
  idPrefix,
  title,
  footer,
}: {
  form: OtpEmailStepModel;
  // エラー文の要素のidの接頭辞(`${idPrefix}-email-error`)。
  idPrefix: string;
  title: string;
  // 全体のエラーの下に置く、サインインへのリンクなど。
  footer: ReactNode;
}) {
  const {
    email,
    setEmail,
    emailFieldErrors,
    primarySubmitting,
    error,
    hydrated,
    handleSendCode,
    turnstileRef,
    setCaptchaToken,
    captchaToken,
  } = form;
  const errorId = `${idPrefix}-email-error`;
  return (
    <>
      <AuthHeader title={title} />
      <form
        onSubmit={handleSendCode}
        noValidate
        data-hydrated={hydrated}
        className="flex w-full flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <Input
            type="email"
            placeholder="you@example.com"
            maxLength={EMAIL_MAX_LENGTH}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(emailFieldErrors.email)}
            aria-describedby={emailFieldErrors.email ? errorId : undefined}
          />
          {emailFieldErrors.email && (
            <p id={errorId} className="text-destructive text-sm">
              {emailFieldErrors.email}
            </p>
          )}
        </div>
        <Turnstile
          ref={turnstileRef}
          onVerify={setCaptchaToken}
          error={emailFieldErrors.captcha}
        />
        <Button
          type="submit"
          data-captcha-ready={captchaToken !== null}
          aria-disabled={primarySubmitting}
          className={cn(primarySubmitting && "pointer-events-none opacity-50")}
        >
          {primarySubmitting && <Loader2 className="size-3.5 animate-spin" />}
          認証コードを送信
        </Button>
      </form>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      {footer}
    </>
  );
}
