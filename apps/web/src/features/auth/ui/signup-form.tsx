"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { type RefObject, useRef, useState } from "react";
import { AuthHeader } from "@/components/auth-header";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { useCountdown } from "@/hooks/use-countdown";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import { cn } from "@/lib/utils";
import type { ScreenView } from "../application/screen-view";
import type { SignUp } from "../application/sign-up";
import {
  initialSignUpFlow,
  type SignUpEvent,
  type SignUpFlow,
  signUpReducer,
} from "../domain/sign-up-flow";
import { OtpCodeStep } from "./otp-code-step";
import { OtpEmailStep } from "./otp-email-step";
import { useScreenView } from "./use-screen-view";

type StepProps = {
  signUp: SignUp;
  flow: SignUpFlow;
  view: ScreenView<SignUpFlow, SignUpEvent>;
};

export function SignUpForm({ signUp }: { signUp: SignUp }) {
  const mounted = useMountedRef();
  const check = useRef<TurnstileInstance>(undefined);
  const { state: flow, view } = useScreenView(
    signUpReducer,
    initialSignUpFlow,
    {
      isMounted: () => mounted.current,
      resetCheck: () => check.current?.reset(),
    },
  );
  const [email, setEmail] = useState("");
  const hydrated = useHydrated();
  useCountdown(flow.resendCooldown, () => view.dispatch({ type: "ticked" }));
  const step = { signUp, flow, view };

  if (flow.step === "password") return <PasswordStep {...step} />;
  if (flow.step === "code")
    return <CodeStep {...step} check={check} email={email} />;
  return (
    <OtpEmailStep
      idPrefix="signup"
      title="サインアップ"
      form={{
        email,
        setEmail,
        emailFieldErrors: flow.fieldErrors,
        primarySubmitting: flow.pending === "send",
        error: flow.error,
        hydrated,
        handleSendCode: (e) => {
          e.preventDefault();
          void signUp.sendCode({ email }, view);
        },
        turnstileRef: check,
        setCaptchaToken: (token) => view.dispatch({ type: "checked", token }),
        captchaToken: flow.captchaToken,
      }}
      footer={
        <p className="text-muted-foreground text-sm">
          既にアカウントをお持ちの方は{" "}
          <Link href="/signin" className="underline">
            サインイン
          </Link>
        </p>
      }
    />
  );
}

// コードの入力値は、この段階の中だけで持つ。戻ると段階ごと破棄され、入力値が残らない。
function CodeStep({
  signUp,
  flow,
  view,
  check,
  email,
}: StepProps & {
  email: string;
  check: RefObject<TurnstileInstance | undefined>;
}) {
  const [code, setCode] = useState("");
  const pending =
    flow.pending === "verify" || flow.pending === "resend"
      ? flow.pending
      : null;
  return (
    <OtpCodeStep
      idPrefix="signup"
      form={{
        email,
        code,
        setCode,
        codeFieldErrors: flow.fieldErrors,
        codeStepPending: pending,
        error: flow.error,
        handleBack: () => view.dispatch({ type: "backed" }),
        handleVerifyCode: (e) => {
          e.preventDefault();
          void signUp.verifyCode({ email, code }, view);
        },
        handleResend: () => void signUp.resend({ email }, view),
        turnstileRef: check,
        setCaptchaToken: (token) => view.dispatch({ type: "checked", token }),
        captchaToken: flow.captchaToken,
        resendCooldown: flow.resendCooldown,
      }}
    />
  );
}

function PasswordStep({ signUp, flow, view }: StepProps) {
  const [password, setPassword] = useState("");
  const submitting = flow.pending === "setPassword";
  return (
    <>
      <AuthHeader
        title="パスワードを設定"
        description="次回以降はこのパスワードでサインインします。"
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void signUp.setPassword({ password }, view);
        }}
        noValidate
        className="flex w-full flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <PasswordInput
            placeholder="パスワード（8文字以上・英数字を含む）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(flow.fieldErrors.password)}
            aria-describedby={
              flow.fieldErrors.password ? "signup-password-error" : undefined
            }
          />
          {flow.fieldErrors.password && (
            <p id="signup-password-error" className="text-destructive text-sm">
              {flow.fieldErrors.password}
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
      {flow.error && (
        <p className="text-center text-destructive text-sm">{flow.error}</p>
      )}
    </>
  );
}
