"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useHydrated } from "@/hooks/use-hydrated";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { EMAIL_MAX_LENGTH } from "../_shared/auth-constants";
import { AuthHeader } from "../_shared/auth-header";
import { Turnstile } from "../_shared/turnstile";
import { initialSignInState, signinReducer } from "./signin-flow";
import { validateSignInFields } from "./validate";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [{ error, fieldErrors }, dispatch] = useReducer(
    signinReducer,
    initialSignInState,
  );
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(undefined);
  const mountedRef = useRef(true);
  // 二重送信の判定は同期的なrefで行う。
  // setSubmitting()由来のstateはレンダーを挟むまで更新されず、連打で2回目の呼び出しが古いsubmitting=falseのクロージャのまま実行されてしまうため、stateだけでは防げない。
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const hydrated = useHydrated();

  function consumeCaptchaToken() {
    turnstileRef.current?.reset();
    setCaptchaToken(null);
  }

  useEffect(() => {
    // Strict Modeの開発時二重実行（マウント→クリーンアップ→再マウント）に対応するため、マウント時にも明示的にtrueへ戻す。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;

    const errors = validateSignInFields(email, password);
    if (errors.email || errors.password) {
      dispatch({ type: "submit_invalid", errors });
      return;
    }
    if (!captchaToken) {
      dispatch({
        type: "submit_invalid",
        errors: { captcha: "セキュリティチェックが完了していません。" },
      });
      return;
    }

    dispatch({ type: "submit_started" });
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken },
      });

      // mountedRefの確認より前にturnstileRefへ触れない。
      // 送信中に別リンクへ移動してアンマウントされていた場合、破棄済みのウィジェットへのreset()呼び出しを避ける。
      if (!mountedRef.current) return;

      if (error) {
        dispatch({ type: "submit_auth_error", error });
        consumeCaptchaToken();
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      // 成功時はここでsubmittingを解除しない。
      // router.push()は遷移先の取得中もこのコンポーネントを保持し続けるため、ここで解除すると遷移完了前にボタンが再度押せる状態に戻り、同じ（使用済みの）captchaトークンで二重に送信されてしまう。
      // アンマウント時に自然に破棄される。
      router.push("/rounds");
    } catch {
      if (!mountedRef.current) return;
      dispatch({ type: "submit_network_error" });
      consumeCaptchaToken();
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      <AuthHeader title="サインイン" />
      <form
        onSubmit={handleSubmit}
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
    </>
  );
}
