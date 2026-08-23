"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
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
      window.location.assign("/rounds");
    }
  }

  if (step === "code") {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-bold">確認コードを入力</h1>
        <p className="text-muted-foreground text-center text-sm">
          {email} に送信された確認コードを入力してください。
        </p>
        <form
          onSubmit={handleVerifyCode}
          className="flex w-full flex-col gap-2"
        >
          <input
            type="text"
            inputMode="numeric"
            required
            placeholder="123456"
            className="rounded-md border px-3 py-2 text-center text-sm tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit">サインイン</Button>
        </form>
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-bold">サインイン</h1>
      <form onSubmit={handleSendCode} className="flex w-full flex-col gap-2">
        <input
          type="email"
          required
          placeholder="you@example.com"
          className="rounded-md border px-3 py-2 text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit">確認コードを送信</Button>
      </form>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </main>
  );
}
