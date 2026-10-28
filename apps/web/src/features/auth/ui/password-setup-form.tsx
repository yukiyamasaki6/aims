"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import Link from "next/link";
import { type RefObject, useState } from "react";
import { AuthHeader } from "@/components/auth-header";
import { BusyButton } from "@/components/ui/busy-button";
import { PasswordInput } from "@/components/ui/password-input";
import { useCountdown } from "@/hooks/use-countdown";
import { useHydrated } from "@/hooks/use-hydrated";
import type { PasswordSetup } from "../application/password-setup";
import type { ScreenView } from "../application/screen-view";
import { PASSWORD_MIN_LENGTH } from "../domain/password";
import {
  initialPasswordSetupFlow,
  type PasswordSetupEvent,
  type PasswordSetupFlow,
  passwordSetupReducer,
} from "../domain/password-setup-flow";
import { SIGN_IN_PATH } from "../domain/routes";
import { AuthField } from "./auth-field";
import { OtpCodeStep } from "./otp-code-step";
import { OtpEmailStep } from "./otp-email-step";
import { useScreenView } from "./use-screen-view";

// サインインへのリンクの文言。リンク先は経路の規則が持つ。
type SignInLinkCopy = { lead?: string; label: string };

// 画面ごとに違う文言とリンク。画面の配置にだけ関わるため、画面の部品が持つ。
export type PasswordSetupCopy = {
  // エラー文の要素のidの接頭辞。
  idPrefix: string;
  emailTitle: string;
  emailFooter: SignInLinkCopy;
  passwordTitle: string;
  passwordDescription: string;
  // パスワード欄の見出し。説明(最小文字数など)は規則の持ち主から得て足す。
  passwordLabel: string;
  passwordSubmit: string;
  passwordFooter: SignInLinkCopy | null;
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
  const {
    state: flow,
    view,
    checkRef: check,
  } = useScreenView(passwordSetupReducer, initialPasswordSetupFlow);
  const [email, setEmail] = useState("");
  const hydrated = useHydrated();
  useCountdown(flow.resendCooldown, () =>
    view.dispatch({ type: "cooldownTicked" }),
  );
  const step = { procedure, copy, flow, view };

  if (flow.step === "password") return <PasswordStep {...step} />;
  if (flow.step === "code")
    return <CodeStep {...step} check={check} email={email} />;
  return (
    <OtpEmailStep
      idPrefix={copy.idPrefix}
      title={copy.emailTitle}
      footer={<SignInLink copy={copy.emailFooter} />}
      email={email}
      onEmailChange={setEmail}
      emailError={flow.fieldErrors.email}
      captchaError={flow.fieldErrors.captcha}
      submitting={flow.pending === "send"}
      error={flow.error}
      hydrated={hydrated}
      onSubmit={(e) => {
        e.preventDefault();
        void procedure.sendCode({ email }, view);
      }}
      checkRef={check}
      onCheck={(token) => view.dispatch({ type: "captchaChecked", token })}
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
      codeError={flow.fieldErrors.code}
      resendError={flow.fieldErrors.resend}
      pending={pending}
      error={flow.error}
      onBack={() => view.dispatch({ type: "emailStepReturned" })}
      onVerify={(e) => {
        e.preventDefault();
        void procedure.verifyCode({ email, code }, view);
      }}
      onResend={() => void procedure.resend({ email }, view)}
      checkRef={check}
      onCheck={(token) => view.dispatch({ type: "captchaChecked", token })}
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
        <AuthField errorId={errorId} error={flow.fieldErrors.password}>
          {(aria) => (
            <PasswordInput
              placeholder={`${copy.passwordLabel}（${PASSWORD_MIN_LENGTH}文字以上・英数字を含む）`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              {...aria}
            />
          )}
        </AuthField>
        <BusyButton type="submit" busy={submitting}>
          {copy.passwordSubmit}
        </BusyButton>
      </form>
      {flow.error && (
        <p className="text-center text-destructive text-sm">{flow.error}</p>
      )}
      {copy.passwordFooter && <SignInLink copy={copy.passwordFooter} />}
    </>
  );
}

function SignInLink({ copy }: { copy: SignInLinkCopy }) {
  return (
    <p className="text-muted-foreground text-sm">
      {copy.lead && <>{copy.lead} </>}
      <Link href={SIGN_IN_PATH} className="underline">
        {copy.label}
      </Link>
    </p>
  );
}
