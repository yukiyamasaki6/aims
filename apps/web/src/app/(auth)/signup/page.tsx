"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { createClient } from "@/lib/supabase/client";

const SignInLink = () => (
  <p className="text-muted-foreground text-sm">
    既にアカウントをお持ちの方は{" "}
    <Link href="/signin" className="underline">
      サインイン
    </Link>
  </p>
);

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [error, setError] = useState<string | null>(null);

  async function handleSendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ email });

    if (error) {
      setError(error.message);
    } else {
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
      type: "email",
    });

    if (error) {
      setError(error.message);
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
      setError(error.message);
    } else {
      window.location.assign("/rounds");
    }
  }

  if (step === "password") {
    return (
      <AuthCard
        title="パスワードを設定"
        description="次回以降はこのパスワードでサインインします。"
      >
        <form
          onSubmit={handleSetPassword}
          className="flex w-full flex-col gap-3"
        >
          <PasswordInput
            required
            minLength={6}
            placeholder="パスワード（6文字以上）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit">登録してサインイン</Button>
        </form>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <SignInLink />
      </AuthCard>
    );
  }

  if (step === "code") {
    return (
      <AuthCard
        title="確認コードを入力"
        description={`${email} に送信された確認コードを入力してください。`}
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
        {error && <p className="text-destructive text-sm">{error}</p>}
        <SignInLink />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="サインアップ">
      <form onSubmit={handleSendCode} className="flex w-full flex-col gap-3">
        <Input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit">確認コードを送信</Button>
      </form>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <SignInLink />
    </AuthCard>
  );
}
