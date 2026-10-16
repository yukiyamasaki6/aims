"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";
import { AuthHeader } from "../_shared/auth-header";
import { OtpCodeStep } from "../_shared/code-step";
import { OtpEmailStep } from "../_shared/email-step";
import { type SignUpFormModel, useSignUpForm } from "./use-signup-form";

export function SignUpForm() {
  const form = useSignUpForm();

  if (form.step === "password") return <PasswordStep form={form} />;
  if (form.step === "code")
    return <OtpCodeStep form={form} idPrefix="signup" />;
  return (
    <OtpEmailStep
      form={form}
      idPrefix="signup"
      title="サインアップ"
      footer={
        <p className="text-muted-foreground text-sm">
          既にアカウントをお持ちの方は{" "}
          <Link href="/signin" className="underline">
            サインイン
          </Link>
        </p>
      }
    />
  );
}

function PasswordStep({ form }: { form: SignUpFormModel }) {
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
        title="パスワードを設定"
        description="次回以降はこのパスワードでサインインします。"
      />
      <form
        onSubmit={handleSetPassword}
        noValidate
        className="flex w-full flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <PasswordInput
            placeholder="パスワード（8文字以上・英数字を含む）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(passwordFieldErrors.password)}
            aria-describedby={
              passwordFieldErrors.password ? "signup-password-error" : undefined
            }
          />
          {passwordFieldErrors.password && (
            <p id="signup-password-error" className="text-destructive text-sm">
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
          登録してサインイン
        </Button>
      </form>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
    </>
  );
}
