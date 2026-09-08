"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Turnstile } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { createClient } from "@/lib/supabase/client";
import { translateAuthErrorMessage } from "@/lib/supabase/errors";
import { cn } from "@/lib/utils";
import { type SignInFieldErrors, validateSignInFields } from "./validate";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<SignInFieldErrors>({});
  const turnstileRef = useRef<TurnstileInstance>(undefined);
  const mountedRef = useRef(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setFieldErrors({});
    const errors = validateSignInFields(email, password);
    if (errors.email || errors.password) {
      setFieldErrors(errors);
      return;
    }
    if (!captchaToken) {
      setFieldErrors({ captcha: "セキュリティチェックが完了していません。" });
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken },
      });

      if (error) {
        setError(translateAuthErrorMessage(error));
        turnstileRef.current?.reset();
        setCaptchaToken(null);
        return;
      }

      // 送信中に別リンク（PW再設定・サインアップ）へ移動してこのコンポーネントが
      // アンマウントされていた場合、遅れて成功しても遷移を横取りしない。
      if (mountedRef.current) {
        router.push("/rounds");
      }
    } catch {
      setError(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      turnstileRef.current?.reset();
      setCaptchaToken(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="サインイン">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex w-full flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <Input
            type="email"
            placeholder="you@example.com"
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
        <div className="flex flex-col items-center gap-1">
          <div
            className={cn(
              "rounded-lg p-1",
              fieldErrors.captcha && "ring-3 ring-destructive/50",
            )}
          >
            <Turnstile ref={turnstileRef} onVerify={setCaptchaToken} />
          </div>
          {fieldErrors.captcha && (
            <p className="text-destructive text-sm">{fieldErrors.captcha}</p>
          )}
        </div>
        <Button
          type="submit"
          data-captcha-ready={captchaToken !== null}
          aria-disabled={submitting}
          className={cn(submitting && "pointer-events-none opacity-50")}
        >
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
