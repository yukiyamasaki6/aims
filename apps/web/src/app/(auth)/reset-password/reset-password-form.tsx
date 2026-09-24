"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useHydrated } from "@/hooks/use-hydrated";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { EMAIL_MAX_LENGTH, OTP_CODE_LENGTH } from "../_shared/auth-constants";
import { AuthHeader } from "../_shared/auth-header";
import { Turnstile } from "../_shared/turnstile";
import {
  initialResetPasswordState,
  resetPasswordReducer,
} from "./reset-password-flow";
import {
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
  const [
    {
      step,
      error,
      emailFieldErrors,
      codeFieldErrors,
      passwordFieldErrors,
      resendCooldown,
      codeStepPending,
    },
    dispatch,
  ] = useReducer(resetPasswordReducer, initialResetPasswordState);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(undefined);
  const mountedRef = useRef(true);
  // 送信・変更の無効化・二重送信防止はprimarySubmittingで持つ。
  // コード入力画面の確認・再送・戻るは排他にし、codeStepBusyRefとcodeStepPendingで扱う。
  // 確認・再送の応答待ちに他の操作を許すと、後から届いた応答が別の画面（メールアドレス入力やパスワード設定）へ反映されてしまうため。
  // 二重送信の判定は同期的なrefで行う。
  // setStateのstateはレンダーを挟むまで更新されず、連打で2回目の呼び出しが古いfalseのクロージャのまま実行されてしまうため、stateだけでは防げない。
  const primarySubmittingRef = useRef(false);
  const [primarySubmitting, setPrimarySubmitting] = useState(false);
  const codeStepBusyRef = useRef(false);
  const hydrated = useHydrated();

  function consumeCaptchaToken() {
    turnstileRef.current?.reset();
    setCaptchaToken(null);
  }

  useEffect(() => {
    if (resendCooldown === 0) return;
    const timer = setTimeout(() => dispatch({ type: "resend_tick" }), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    // Strict Modeの開発時二重実行（マウント→クリーンアップ→再マウント）に対応するため、マウント時にも明示的にtrueへ戻す。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function handleBack() {
    if (codeStepBusyRef.current) return;
    dispatch({ type: "reset_to_email" });
    setCode("");
    setCaptchaToken(null);
  }

  async function handleResend() {
    if (codeStepBusyRef.current) return;

    const errors = validateResendReady(resendCooldown, captchaToken);
    if (errors.resend || !captchaToken) {
      dispatch({ type: "resend_invalid", errors });
      return;
    }

    codeStepBusyRef.current = true;
    dispatch({ type: "resend_started" });

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        captchaToken,
      });

      // mountedRefの確認より前にturnstileRefへ触れない。
      // 送信中に別リンクへ移動してアンマウントされていた場合、破棄済みのウィジェットへのreset()呼び出しを避ける。
      if (!mountedRef.current) return;

      consumeCaptchaToken();

      if (error) {
        dispatch({ type: "resend_auth_error", error });
      } else {
        dispatch({ type: "resend_succeeded" });
      }
      codeStepBusyRef.current = false;
    } catch {
      if (!mountedRef.current) return;
      dispatch({ type: "resend_network_error" });
      codeStepBusyRef.current = false;
    }
  }

  async function handleSendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (primarySubmittingRef.current) return;

    const errors = validateEmailField(email);
    if (errors.email) {
      dispatch({ type: "send_code_invalid", errors });
      return;
    }
    if (!captchaToken) {
      dispatch({
        type: "send_code_invalid",
        errors: { captcha: "セキュリティチェックが完了していません。" },
      });
      return;
    }

    dispatch({ type: "send_code_started" });
    primarySubmittingRef.current = true;
    setPrimarySubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        captchaToken,
      });

      if (!mountedRef.current) return;

      consumeCaptchaToken();

      if (error) {
        dispatch({ type: "send_code_auth_error", error });
      } else {
        dispatch({ type: "send_code_succeeded" });
      }
      primarySubmittingRef.current = false;
      setPrimarySubmitting(false);
    } catch {
      if (!mountedRef.current) return;
      dispatch({ type: "send_code_network_error" });
      primarySubmittingRef.current = false;
      setPrimarySubmitting(false);
    }
  }

  async function handleVerifyCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (codeStepBusyRef.current) return;

    const errors = validateCodeField(code);
    if (errors.code) {
      dispatch({ type: "verify_code_invalid", errors });
      return;
    }

    codeStepBusyRef.current = true;
    dispatch({ type: "verify_code_started" });
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "recovery",
      });

      if (!mountedRef.current) return;

      if (error) {
        dispatch({ type: "verify_code_auth_error", error });
      } else {
        dispatch({ type: "verify_code_succeeded" });
      }
      codeStepBusyRef.current = false;
    } catch {
      if (!mountedRef.current) return;
      dispatch({ type: "verify_code_network_error" });
      codeStepBusyRef.current = false;
    }
  }

  async function handleSetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (primarySubmittingRef.current) return;

    const errors = validatePasswordField(password);
    if (errors.password) {
      dispatch({ type: "set_password_invalid", errors });
      return;
    }

    dispatch({ type: "set_password_started" });
    primarySubmittingRef.current = true;
    setPrimarySubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (!mountedRef.current) return;

      if (error) {
        dispatch({ type: "set_password_auth_error", error });
        primarySubmittingRef.current = false;
        setPrimarySubmitting(false);
        return;
      }

      await supabase.auth.signOut();
      window.location.assign("/signin");
    } catch {
      if (!mountedRef.current) return;
      dispatch({ type: "set_password_network_error" });
      primarySubmittingRef.current = false;
      setPrimarySubmitting(false);
    }
  }

  if (step === "password") {
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
            className={cn(
              primarySubmitting && "pointer-events-none opacity-50",
            )}
          >
            {primarySubmitting && <Loader2 className="size-3.5 animate-spin" />}
            パスワードを変更
          </Button>
        </form>
        {error && (
          <p className="text-center text-destructive text-sm">{error}</p>
        )}
        <SignInLink />
      </>
    );
  }

  if (step === "code") {
    return (
      <>
        <AuthHeader
          title="認証コードを入力"
          description={`${email} に送信されたコードを入力してください。`}
          onBack={handleBack}
          backDisabled={codeStepPending !== null}
        />
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
        {error && (
          <p className="text-center text-destructive text-sm">{error}</p>
        )}
        <p className="text-center text-muted-foreground text-sm">
          メールが届かない場合は、迷惑メールフォルダをご確認ください。
        </p>
        <Turnstile ref={turnstileRef} onVerify={setCaptchaToken} />
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
            onClick={handleResend}
          >
            {codeStepPending === "resend" && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            {resendCooldown > 0 ? `再送（${resendCooldown}秒）` : "再送"}
          </Button>
          {codeFieldErrors.resend && (
            <p className="text-destructive text-sm">{codeFieldErrors.resend}</p>
          )}
        </div>
      </>
    );
  }

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
