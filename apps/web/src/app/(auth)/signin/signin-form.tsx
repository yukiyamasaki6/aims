"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { Loader2 } from "lucide-react";
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
  // 二重送信の判定は同期的なrefで行う。setSubmitting()由来のstateはレンダーを
  // 挟むまで更新されず、連打で2回目のhandleSubmitが古いsubmitting=falseの
  // クロージャのまま実行されてしまうため、stateだけでは防げない。
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Strict Modeの開発時二重実行（マウント→クリーンアップ→再マウント）に
    // 対応するため、マウント時にも明示的にtrueへ戻す。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
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

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken },
      });

      // 送信中に別リンク（PW再設定・サインアップ）へ移動してこのコンポーネントが
      // アンマウントされていた場合、遅れて届いた結果では何もしない。
      if (!mountedRef.current) return;

      if (error) {
        setError(translateAuthErrorMessage(error));
        turnstileRef.current?.reset();
        setCaptchaToken(null);
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      // 成功時はここでsubmittingを解除しない。router.push()は遷移先の取得中も
      // このコンポーネントを保持し続けるため、ここで解除すると遷移完了前に
      // ボタンが再度押せる状態に戻り、同じ（使用済みの）captchaトークンで
      // 二重に送信されてしまう。アンマウント時に自然に破棄される。
      router.push("/rounds");
    } catch {
      if (!mountedRef.current) return;
      setError(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      turnstileRef.current?.reset();
      setCaptchaToken(null);
      submittingRef.current = false;
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
    </AuthCard>
  );
}
