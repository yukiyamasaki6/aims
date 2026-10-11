"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";
import { EMAIL_MAX_LENGTH, OTP_CODE_LENGTH } from "../_shared/auth-constants";
import { AuthHeader } from "../_shared/auth-header";
import { Turnstile } from "../_shared/turnstile";
import {
  type ResetPasswordFormModel,
  useResetPasswordForm,
} from "./use-reset-password-form";

const SignInLink = () => (
  <p className="text-muted-foreground text-sm">
    <Link href="/signin" className="underline">
      サインインに戻る
    </Link>
  </p>
);

export function ResetPasswordForm() {
  const form = useResetPasswordForm();

  if (form.step === "password") return <PasswordStep form={form} />;
  if (form.step === "code") return <CodeStep form={form} />;
  return <EmailStep form={form} />;
}

function PasswordStep({ form }: { form: ResetPasswordFormModel }) {
  const {
    password,
    setPassword,
    passwordFieldErrors,
    primarySubmitting,
    error,
    handleSetPassword,
  } = form;
  return (
    <>
      <AuthHeader
        title="新しいパスワードを設定"
        description="このパスワードで次回からサインインします。"
      />
      <form
        onSubmit={handleSetPassword}
        noValidate
        className="flex w-full flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <PasswordInput
            placeholder="新しいパスワード（8文字以上・英数字を含む）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(passwordFieldErrors.password)}
            aria-describedby={
              passwordFieldErrors.password
                ? "reset-password-password-error"
                : undefined
            }
          />
          {passwordFieldErrors.password && (
            <p
              id="reset-password-password-error"
              className="text-destructive text-sm"
            >
              {passwordFieldErrors.password}
            </p>
          )}
        </div>
        <Button
          type="submit"
          aria-disabled={primarySubmitting}
          className={cn(primarySubmitting && "pointer-events-none opacity-50")}
        >
          {primarySubmitting && <Loader2 className="size-3.5 animate-spin" />}
          パスワードを変更
        </Button>
      </form>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      <SignInLink />
    </>
  );
}

function CodeStep({ form }: { form: ResetPasswordFormModel }) {
  const {
    email,
    code,
    setCode,
    codeFieldErrors,
    codeStepPending,
    error,
    handleBack,
    handleVerifyCode,
    handleResend,
    turnstileRef,
    setCaptchaToken,
    captchaToken,
    resendCooldown,
  } = form;
  return (
    <>
      <AuthHeader
        title="認証コードを入力"
        description={`${email} に送信されたコードを入力してください。`}
        onBack={handleBack}
        backDisabled={codeStepPending !== null}
      />
      <CodeEntryForm
        code={code}
        setCode={setCode}
        codeFieldErrors={codeFieldErrors}
        codeStepPending={codeStepPending}
        onSubmit={handleVerifyCode}
      />
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      <p className="text-center text-muted-foreground text-sm">
        メールが届かない場合は、迷惑メールフォルダをご確認ください。
      </p>
      <Turnstile ref={turnstileRef} onVerify={setCaptchaToken} />
      <ResendSection
        codeStepPending={codeStepPending}
        captchaToken={captchaToken}
        resendCooldown={resendCooldown}
        resendError={codeFieldErrors.resend}
        onResend={handleResend}
      />
    </>
  );
}

function CodeEntryForm({
  code,
  setCode,
  codeFieldErrors,
  codeStepPending,
  onSubmit,
}: {
  code: string;
  setCode: (value: string) => void;
  codeFieldErrors: ResetPasswordFormModel["codeFieldErrors"];
  codeStepPending: ResetPasswordFormModel["codeStepPending"];
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Input
          type="text"
          inputMode="numeric"
          placeholder="123456"
          className="text-center tracking-widest"
          maxLength={OTP_CODE_LENGTH}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={Boolean(codeFieldErrors.code)}
          aria-describedby={
            codeFieldErrors.code ? "reset-password-code-error" : undefined
          }
        />
        {codeFieldErrors.code && (
          <p
            id="reset-password-code-error"
            className="text-destructive text-sm"
          >
            {codeFieldErrors.code}
          </p>
        )}
      </div>
      <Button
        type="submit"
        aria-disabled={codeStepPending !== null}
        className={cn(
          codeStepPending !== null && "pointer-events-none opacity-50",
        )}
      >
        {codeStepPending === "verify" && (
          <Loader2 className="size-3.5 animate-spin" />
        )}
        確認
      </Button>
    </form>
  );
}

function ResendSection({
  codeStepPending,
  captchaToken,
  resendCooldown,
  resendError,
  onResend,
}: {
  codeStepPending: ResetPasswordFormModel["codeStepPending"];
  captchaToken: string | null;
  resendCooldown: number;
  resendError: string | undefined;
  onResend: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-1">
      <Button
        type="button"
        variant="outline"
        className={cn(
          "w-full",
          codeStepPending !== null && "pointer-events-none opacity-50",
        )}
        aria-disabled={codeStepPending !== null}
        data-captcha-ready={captchaToken !== null}
        onClick={onResend}
      >
        {codeStepPending === "resend" && (
          <Loader2 className="size-3.5 animate-spin" />
        )}
        {resendCooldown > 0 ? `再送（${resendCooldown}秒）` : "再送"}
      </Button>
      {resendError && <p className="text-destructive text-sm">{resendError}</p>}
    </div>
  );
}

function EmailStep({ form }: { form: ResetPasswordFormModel }) {
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
  return (
    <>
      <AuthHeader title="パスワードを再設定" />
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
            aria-describedby={
              emailFieldErrors.email ? "reset-password-email-error" : undefined
            }
          />
          {emailFieldErrors.email && (
            <p
              id="reset-password-email-error"
              className="text-destructive text-sm"
            >
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
      <SignInLink />
    </>
  );
}
