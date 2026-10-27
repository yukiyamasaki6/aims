"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { Loader2 } from "lucide-react";
import type { FormEvent, ReactNode, RefObject } from "react";
import { AuthHeader } from "@/components/auth-header";
import { Turnstile } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EMAIL_MAX_LENGTH } from "../domain/email-address";

type OtpEmailStepProps = {
  // エラー文の要素のidの接頭辞(`${idPrefix}-email-error`)。
  idPrefix: string;
  title: string;
  // 全体のエラーの下に置く、サインインへのリンクなど。
  footer: ReactNode;
  email: string;
  onEmailChange: (value: string) => void;
  fieldErrors: { email?: string; captcha?: string };
  submitting: boolean;
  error: string | null;
  hydrated: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  checkRef: RefObject<TurnstileInstance | undefined>;
  onCheck: (token: string | null) => void;
  // セキュリティチェックが完了している(トークンがある)か。
  checked: boolean;
};

export function OtpEmailStep({
  idPrefix,
  title,
  footer,
  email,
  onEmailChange,
  fieldErrors,
  submitting,
  error,
  hydrated,
  onSubmit,
  checkRef,
  onCheck,
  checked,
}: OtpEmailStepProps) {
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
        <div className="flex flex-col gap-1">
          <Input
            type="email"
            placeholder="you@example.com"
            maxLength={EMAIL_MAX_LENGTH}
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? errorId : undefined}
          />
          {fieldErrors.email && (
            <p id={errorId} className="text-destructive text-sm">
              {fieldErrors.email}
            </p>
          )}
        </div>
        <Turnstile
          ref={checkRef}
          onVerify={onCheck}
          error={fieldErrors.captcha}
        />
        <Button
          type="submit"
          data-captcha-ready={checked}
          aria-disabled={submitting}
          className={cn(submitting && "pointer-events-none opacity-50")}
        >
          {submitting && <Loader2 className="size-3.5 animate-spin" />}
          認証コードを送信
        </Button>
      </form>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      {footer}
    </>
  );
}
