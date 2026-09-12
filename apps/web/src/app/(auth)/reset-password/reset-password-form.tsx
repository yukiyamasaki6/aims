"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Turnstile } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useHydrated } from "@/hooks/use-hydrated";
import { createClient } from "@/lib/supabase/client";
import { translateAuthErrorMessage } from "@/lib/supabase/errors";
import { cn } from "@/lib/utils";
import { EMAIL_MAX_LENGTH, OTP_CODE_LENGTH } from "../auth-constants";
import {
  type ResetPasswordCodeFieldErrors,
  type ResetPasswordEmailFieldErrors,
  type ResetPasswordPasswordFieldErrors,
  validateCodeField,
  validateEmailField,
  validatePasswordField,
  validateResendReady,
} from "./validate";

const SignInLink = () => (
  <p className="text-muted-foreground text-sm">
    <Link href="/signin" className="underline">
      サインインに戻る
    </Link>
  </p>
);

export function ResetPasswordForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [error, setError] = useState<string | null>(null);
  const [emailFieldErrors, setEmailFieldErrors] = useState<
    ResetPasswordEmailFieldErrors & { captcha?: string }
  >({});
  const [codeFieldErrors, setCodeFieldErrors] =
    useState<ResetPasswordCodeFieldErrors>({});
  const [passwordFieldErrors, setPasswordFieldErrors] =
    useState<ResetPasswordPasswordFieldErrors>({});
  const [resendCooldown, setResendCooldown] = useState(0);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(undefined);
  const mountedRef = useRef(true);
  // 二重送信の判定は同期的なrefで行う。setSubmitting()由来のstateはレンダーを
  // 挟むまで更新されず、連打で2回目の呼び出しが古いsubmitting=falseの
  // クロージャのまま実行されてしまうため、stateだけでは防げない。
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const hydrated = useHydrated();

  function consumeCaptchaToken() {
    turnstileRef.current?.reset();
    setCaptchaToken(null);
  }

  useEffect(() => {
    if (resendCooldown === 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    // Strict Modeの開発時二重実行（マウント→クリーンアップ→再マウント）に
    // 対応するため、マウント時にも明示的にtrueへ戻す。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function handleBack() {
    setStep("email");
    setCode("");
    setError(null);
    setCaptchaToken(null);
    setCodeFieldErrors({});
  }

  async function handleResend() {
    if (submittingRef.current) return;
    setError(null);
    setCodeFieldErrors({});

    const errors = validateResendReady(resendCooldown, captchaToken);
    if (errors.resend || !captchaToken) {
      setCodeFieldErrors(errors);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setResendCooldown(60);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      captchaToken,
    });

    // mountedRefの確認より前にturnstileRefへ触れない。送信中に別リンクへ
    // 移動してアンマウントされていた場合、破棄済みのウィジェットへの
    // reset()呼び出しを避ける。
    if (!mountedRef.current) return;

    consumeCaptchaToken();

    if (error) {
      setError(translateAuthErrorMessage(error));
    }
    submittingRef.current = false;
    setSubmitting(false);
  }

  async function handleSendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);
    setEmailFieldErrors({});

    const errors = validateEmailField(email);
    if (errors.email) {
      setEmailFieldErrors(errors);
      return;
    }
    if (!captchaToken) {
      setEmailFieldErrors({
        captcha: "セキュリティチェックが完了していません。",
      });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        captchaToken,
      });

      if (!mountedRef.current) return;

      consumeCaptchaToken();

      if (error) {
        setError(translateAuthErrorMessage(error));
      } else {
        setResendCooldown(60);
        setStep("code");
      }
      submittingRef.current = false;
      setSubmitting(false);
    } catch {
      if (!mountedRef.current) return;
      setError(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);
    setCodeFieldErrors({});

    const errors = validateCodeField(code);
    if (errors.code) {
      setCodeFieldErrors(errors);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "recovery",
      });

      if (!mountedRef.current) return;

      if (error) {
        setError(translateAuthErrorMessage(error));
      } else {
        setStep("password");
      }
      submittingRef.current = false;
      setSubmitting(false);
    } catch {
      if (!mountedRef.current) return;
      setError(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleSetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);
    setPasswordFieldErrors({});

    const errors = validatePasswordField(password);
    if (errors.password) {
      setPasswordFieldErrors(errors);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (!mountedRef.current) return;

      if (error) {
        setError(translateAuthErrorMessage(error));
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      await supabase.auth.signOut();
      window.location.assign("/signin");
    } catch {
      if (!mountedRef.current) return;
      setError(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (step === "password") {
    return (
      <AuthCard
        title="新しいパスワードを設定"
        description="このパスワードで次回からサインインします。"
      >
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
            aria-disabled={submitting}
            className={cn(submitting && "pointer-events-none opacity-50")}
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            パスワードを変更
          </Button>
        </form>
        {error && (
          <p className="text-center text-destructive text-sm">{error}</p>
        )}
        <SignInLink />
      </AuthCard>
    );
  }

  if (step === "code") {
    return (
      <AuthCard
        title="認証コードを入力"
        description={`${email} に送信されたコードを入力してください。`}
        onBack={handleBack}
      >
        <form
          onSubmit={handleVerifyCode}
          noValidate
          className="flex w-full flex-col gap-3"
        >
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
            aria-disabled={submitting}
            className={cn(submitting && "pointer-events-none opacity-50")}
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            確認
          </Button>
        </form>
        {error && (
          <p className="text-center text-destructive text-sm">{error}</p>
        )}
        <p className="text-center text-muted-foreground text-sm">
          メールが届かない場合は、迷惑メールフォルダをご確認ください。
        </p>
        <Turnstile ref={turnstileRef} onVerify={setCaptchaToken} />
        <div className="flex flex-col items-center gap-1">
          <Button
            type="button"
            variant="outline"
            className={cn(
              "w-full",
              submitting && "pointer-events-none opacity-50",
            )}
            aria-disabled={submitting}
            data-captcha-ready={captchaToken !== null}
            onClick={handleResend}
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {resendCooldown > 0 ? `再送（${resendCooldown}秒）` : "再送"}
          </Button>
          {codeFieldErrors.resend && (
            <p className="text-destructive text-sm">{codeFieldErrors.resend}</p>
          )}
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="パスワードを再設定">
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
        <div className="flex flex-col items-center gap-1">
          <div
            className={cn(
              "rounded-lg p-1",
              emailFieldErrors.captcha && "ring-3 ring-destructive/50",
            )}
          >
            <Turnstile ref={turnstileRef} onVerify={setCaptchaToken} />
          </div>
          {emailFieldErrors.captcha && (
            <p className="text-destructive text-sm">
              {emailFieldErrors.captcha}
            </p>
          )}
        </div>
        <Button
          type="submit"
          data-captcha-ready={captchaToken !== null}
          aria-disabled={submitting}
          className={cn(submitting && "pointer-events-none opacity-50")}
        >
          {submitting && <Loader2 className="size-3.5 animate-spin" />}
          認証コードを送信
        </Button>
      </form>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      <SignInLink />
    </AuthCard>
  );
}
