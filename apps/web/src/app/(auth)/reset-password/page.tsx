"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Turnstile } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { createClient } from "@/lib/supabase/client";
import { translateAuthErrorMessage } from "@/lib/supabase/errors";

const SignInLink = () => (
  <p className="text-muted-foreground text-sm">
    <Link href="/signin" className="underline">
      サインインに戻る
    </Link>
  </p>
);

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(undefined);

  function consumeCaptchaToken() {
    turnstileRef.current?.reset();
    setCaptchaToken(null);
  }

  useEffect(() => {
    if (resendCooldown === 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  function handleBack() {
    setStep("email");
    setCode("");
    setError(null);
    setCaptchaToken(null);
  }

  async function handleResend() {
    if (!captchaToken) return;
    setError(null);
    setResendCooldown(60);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      captchaToken,
    });
    consumeCaptchaToken();

    if (error) {
      setError(translateAuthErrorMessage(error));
    }
  }

  async function handleSendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!captchaToken) return;
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      captchaToken,
    });
    consumeCaptchaToken();

    if (error) {
      setError(translateAuthErrorMessage(error));
    } else {
      setResendCooldown(60);
      setStep("code");
    }
  }

  async function handleVerifyCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "recovery",
    });

    if (error) {
      setError(translateAuthErrorMessage(error));
    } else {
      setStep("password");
    }
  }

  async function handleSetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(translateAuthErrorMessage(error));
    } else {
      await supabase.auth.signOut();
      window.location.assign("/signin");
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
          className="flex w-full flex-col gap-3"
        >
          <PasswordInput
            required
            minLength={6}
            placeholder="新しいパスワード（6文字以上）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit">パスワードを変更</Button>
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
          className="flex w-full flex-col gap-3"
        >
          <Input
            type="text"
            inputMode="numeric"
            required
            placeholder="123456"
            className="text-center tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit">確認</Button>
        </form>
        {error && (
          <p className="text-center text-destructive text-sm">{error}</p>
        )}
        <p className="text-center text-muted-foreground text-sm">
          メールが届かない場合は、迷惑メールフォルダをご確認ください。
        </p>
        <Turnstile ref={turnstileRef} onVerify={setCaptchaToken} />
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={resendCooldown > 0 || !captchaToken}
          onClick={handleResend}
        >
          {resendCooldown > 0 ? `再送（${resendCooldown}秒）` : "再送"}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="パスワードを再設定">
      <form onSubmit={handleSendCode} className="flex w-full flex-col gap-3">
        <Input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Turnstile ref={turnstileRef} onVerify={setCaptchaToken} />
        <Button type="submit" disabled={!captchaToken}>
          認証コードを送信
        </Button>
      </form>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      <SignInLink />
    </AuthCard>
  );
}
