"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { Loader2 } from "lucide-react";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { AuthHeader } from "@/components/auth-header";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { useCountdown } from "@/hooks/use-countdown";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import { cn } from "@/lib/utils";
import type { PasswordSetup } from "../application/password-setup";
import type { ScreenView } from "../application/screen-view";
import {
  initialPasswordSetupFlow,
  type PasswordSetupEvent,
  type PasswordSetupFlow,
  passwordSetupReducer,
} from "../domain/password-setup-flow";
import { OtpCodeStep } from "./otp-code-step";
import { OtpEmailStep } from "./otp-email-step";
import { useScreenView } from "./use-screen-view";

// 画面ごとに違う文言とリンク。画面の配置にだけ関わるため、画面の部品が持つ。
export type PasswordSetupCopy = {
  // エラー文の要素のidの接頭辞。
  idPrefix: string;
  emailTitle: string;
  emailFooter: ReactNode;
  passwordTitle: string;
  passwordDescription: string;
  passwordPlaceholder: string;
  passwordSubmit: string;
  passwordFooter: ReactNode;
};

type StepProps = {
  procedure: PasswordSetup;
  copy: PasswordSetupCopy;
  flow: PasswordSetupFlow;
  view: ScreenView<PasswordSetupFlow, PasswordSetupEvent>;
};

// メール入力、コード入力、パスワード設定の3段階の画面。サインアップとパスワード再設定が使う。
export function PasswordSetupForm({
  procedure,
  copy,
}: {
  procedure: PasswordSetup;
  copy: PasswordSetupCopy;
}) {
  const mounted = useMountedRef();
  const check = useRef<TurnstileInstance>(undefined);
  const { state: flow, view } = useScreenView(
    passwordSetupReducer,
    initialPasswordSetupFlow,
    {
      isMounted: () => mounted.current,
      resetCheck: () => check.current?.reset(),
    },
  );
  const [email, setEmail] = useState("");
  const hydrated = useHydrated();
  useCountdown(flow.resendCooldown, () => view.dispatch({ type: "ticked" }));
  const step = { procedure, copy, flow, view };

  if (flow.step === "password") return <PasswordStep {...step} />;
  if (flow.step === "code")
    return <CodeStep {...step} check={check} email={email} />;
  return (
    <OtpEmailStep
      idPrefix={copy.idPrefix}
      title={copy.emailTitle}
      footer={copy.emailFooter}
      email={email}
      onEmailChange={setEmail}
      fieldErrors={flow.fieldErrors}
      submitting={flow.pending === "send"}
      error={flow.error}
      hydrated={hydrated}
      onSubmit={(e) => {
        e.preventDefault();
        void procedure.sendCode({ email }, view);
      }}
      checkRef={check}
      onCheck={(token) => view.dispatch({ type: "checked", token })}
      checked={flow.captchaToken !== null}
    />
  );
}

// コードの入力値は、この段階の中だけで持つ。戻ると段階ごと破棄され、入力値が残らない。
function CodeStep({
  procedure,
  copy,
  flow,
  view,
  check,
  email,
}: StepProps & {
  check: RefObject<TurnstileInstance | undefined>;
  email: string;
}) {
  const [code, setCode] = useState("");
  const pending =
    flow.pending === "verify" || flow.pending === "resend"
      ? flow.pending
      : null;
  return (
    <OtpCodeStep
      idPrefix={copy.idPrefix}
      email={email}
      code={code}
      onCodeChange={setCode}
      fieldErrors={flow.fieldErrors}
      pending={pending}
      error={flow.error}
      onBack={() => view.dispatch({ type: "backed" })}
      onVerify={(e) => {
        e.preventDefault();
        void procedure.verifyCode({ email, code }, view);
      }}
      onResend={() => void procedure.resend({ email }, view)}
      checkRef={check}
      onCheck={(token) => view.dispatch({ type: "checked", token })}
      checked={flow.captchaToken !== null}
      resendCooldown={flow.resendCooldown}
    />
  );
}

function PasswordStep({ procedure, copy, flow, view }: StepProps) {
  const [password, setPassword] = useState("");
  const submitting = flow.pending === "setPassword";
  const errorId = `${copy.idPrefix}-password-error`;
  return (
    <>
      <AuthHeader
        title={copy.passwordTitle}
        description={copy.passwordDescription}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void procedure.setPassword({ password }, view);
        }}
        noValidate
        className="flex w-full flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <PasswordInput
            placeholder={copy.passwordPlaceholder}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(flow.fieldErrors.password)}
            aria-describedby={flow.fieldErrors.password ? errorId : undefined}
          />
          {flow.fieldErrors.password && (
            <p id={errorId} className="text-destructive text-sm">
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
          {copy.passwordSubmit}
        </Button>
      </form>
      {flow.error && (
        <p className="text-center text-destructive text-sm">{flow.error}</p>
      )}
      {copy.passwordFooter}
    </>
  );
}
