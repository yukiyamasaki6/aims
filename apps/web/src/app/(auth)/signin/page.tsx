"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Turnstile } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { signIn } from "@/lib/supabase/actions";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(undefined);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!captchaToken) return;
    setError(null);

    const result = await signIn(email, password, captchaToken);

    if (result?.error) {
      setError(result.error);
      turnstileRef.current?.reset();
      setCaptchaToken(null);
    }
  }

  return (
    <AuthCard title="サインイン">
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
        <Input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordInput
          required
          placeholder="パスワード"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Turnstile ref={turnstileRef} onVerify={setCaptchaToken} />
        <Button type="submit" disabled={!captchaToken}>
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
    </AuthCard>
  );
}
