"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";
import { AuthHeader } from "../_shared/auth-header";
import { OtpCodeStep } from "../_shared/code-step";
import { OtpEmailStep } from "../_shared/email-step";
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
  if (form.step === "code")
    return <OtpCodeStep form={form} idPrefix="reset-password" />;
  return (
    <OtpEmailStep
      form={form}
      idPrefix="reset-password"
      title="パスワードを再設定"
      footer={<SignInLink />}
    />
  );
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
