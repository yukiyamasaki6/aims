"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";
import { EMAIL_MAX_LENGTH } from "../_shared/auth-constants";
import { AuthHeader } from "../_shared/auth-header";
import { Turnstile } from "../_shared/turnstile";
import { type SignInFormModel, useSignInForm } from "./use-signin-form";

export function SignInForm() {
  const {
    email,
    setEmail,
    password,
    setPassword,
    error,
    fieldErrors,
    captchaToken,
    setCaptchaToken,
    turnstileRef,
    submitting,
    hydrated,
    onSubmit,
  } = useSignInForm();

  return (
    <>
      <AuthHeader title="サインイン" />
      <form
        onSubmit={onSubmit}
        noValidate
        data-hydrated={hydrated}
        className="flex w-full flex-col gap-3"
      >
        <SignInFields
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          fieldErrors={fieldErrors}
        />
        <Turnstile
          ref={turnstileRef}
          onVerify={setCaptchaToken}
          error={fieldErrors.captcha}
        />
        <Button
          type="submit"
          data-captcha-ready={captchaToken !== null}
          aria-disabled={submitting}
          className={cn(submitting && "pointer-events-none opacity-50")}
        >
          {submitting && <Loader2 className="size-3.5 animate-spin" />}
          サインイン
        </Button>
      </form>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      <p className="text-muted-foreground text-sm">
        <Link href="/reset-password" className="underline">
          パスワードをお忘れですか
        </Link>
      </p>
      <p className="text-muted-foreground text-sm">
        アカウントをお持ちでない方は{" "}
        <Link href="/signup" className="underline">
          サインアップ
        </Link>
      </p>
    </>
  );
}

function SignInFields({
  email,
  setEmail,
  password,
  setPassword,
  fieldErrors,
}: {
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  fieldErrors: SignInFormModel["fieldErrors"];
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <Input
          type="email"
          placeholder="you@example.com"
          maxLength={EMAIL_MAX_LENGTH}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={
            fieldErrors.email ? "signin-email-error" : undefined
          }
        />
        {fieldErrors.email && (
          <p id="signin-email-error" className="text-destructive text-sm">
            {fieldErrors.email}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <PasswordInput
          placeholder="パスワード"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={
            fieldErrors.password ? "signin-password-error" : undefined
          }
        />
        {fieldErrors.password && (
          <p id="signin-password-error" className="text-destructive text-sm">
            {fieldErrors.password}
          </p>
        )}
      </div>
    </>
  );
}
