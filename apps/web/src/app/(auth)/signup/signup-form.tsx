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
import { useHydrated } from "@/hooks/use-hydrated";
import { isEmailRegistered } from "@/lib/supabase/actions";
import { createClient } from "@/lib/supabase/client";
import { translateAuthErrorMessage } from "@/lib/supabase/errors";
import { cn } from "@/lib/utils";
import {
  type SignUpPasswordFieldErrors,
  validatePasswordField,
} from "./validate";

const SignInLink = () => (
  <p className="text-muted-foreground text-sm">
    既にアカウントをお持ちの方は{" "}
    <Link href="/signin" className="underline">
      サインイン
    </Link>
  </p>
);

export function SignUpForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [error, setError] = useState<string | null>(null);
  const [passwordFieldErrors, setPasswordFieldErrors] =
    useState<SignUpPasswordFieldErrors>({});
  const [resendCooldown, setResendCooldown] = useState(0);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(undefined);
  const mountedRef = useRef(true);
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
  }

  async function handleResend() {
    if (!captchaToken) return;
    setError(null);
    setResendCooldown(60);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { captchaToken },
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

    if (await isEmailRegistered(email)) {
      // このチェックはcaptchaTokenを使わないため、まだ消費されていない
      // トークンをここでリセットする必要はない（次の送信でそのまま使える）。
      setError("このメールアドレスは既に登録されています。");
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { captchaToken },
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
      type: "email",
    });

    if (error) {
      setError(translateAuthErrorMessage(error));
    } else {
      setStep("password");
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

      // 送信中にアンマウントされていた場合、遅れて届いた結果では何もしない。
      if (!mountedRef.current) return;

      if (error) {
        setError(translateAuthErrorMessage(error));
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      // 成功時はここでsubmittingを解除しない。router.push()は遷移先の取得中も
      // このコンポーネントを保持し続けるため、ここで解除すると遷移完了前に
      // ボタンが再度押せる状態に戻ってしまう。アンマウント時に自然に破棄される。
      router.push("/rounds");
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
        title="パスワードを設定"
        description="次回以降はこのパスワードでサインインします。"
      >
        <form
          onSubmit={handleSetPassword}
          noValidate
          className="flex w-full flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <PasswordInput
              placeholder="パスワード（8文字以上・英数字を含む）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(passwordFieldErrors.password)}
              aria-describedby={
                passwordFieldErrors.password
                  ? "signup-password-error"
                  : undefined
              }
            />
            {passwordFieldErrors.password && (
              <p
                id="signup-password-error"
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
            登録してサインイン
          </Button>
        </form>
        {error && (
          <p className="text-center text-destructive text-sm">{error}</p>
        )}
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
    <AuthCard title="サインアップ">
      <form
        onSubmit={handleSendCode}
        data-hydrated={hydrated}
        className="flex w-full flex-col gap-3"
      >
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
