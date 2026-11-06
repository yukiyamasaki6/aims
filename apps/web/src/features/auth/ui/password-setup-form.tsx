"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type RefObject, useEffect, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { useHydrated } from "@/hooks/use-hydrated";
import type { PasswordSetup } from "../application/password-setup";
import type { ScreenView } from "../application/screen-view";
import { SIGN_IN_PATH } from "../domain/auth-routes";
import { PASSWORD_MIN_LENGTH } from "../domain/password";
import {
  initialPasswordSetupFlow,
  type PasswordSetupEvent,
  type PasswordSetupFlow,
  passwordSetupReducer,
} from "../domain/password-setup-flow";
import { AuthField } from "./auth-field";
import { AuthHeader } from "./auth-header";
import { OtpCodeStep } from "./otp-code-step";
import { OtpEmailStep } from "./otp-email-step";
import { PasswordInput } from "./password-input";
import { useAuthTexts } from "./use-auth-texts";
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
  // コード入力の段階に出す案内(無ければ出さない)。
  codeNote?: string;
};

type StepProps = {
  procedure: PasswordSetup;
  copy: PasswordSetupCopy;
  flow: PasswordSetupFlow;
  view: ScreenView<PasswordSetupFlow, PasswordSetupEvent>;
  siteKey: string;
};

// メール入力、コード入力、パスワード設定の3段階の画面。サインアップとパスワード再設定が使う。
export function PasswordSetupForm({
  procedure,
  copy,
  siteKey,
}: {
  procedure: PasswordSetup;
  copy: PasswordSetupCopy;
  siteKey: string;
}) {
  const {
    state: flow,
    view,
    checkRef: check,
  } = useScreenView(passwordSetupReducer, initialPasswordSetupFlow);
  const [email, setEmail] = useState("");
  const hydrated = useHydrated();
  const texts = useAuthTexts();
  const { dispatch } = view;
  // 残りが変わるたびに1秒の予約をやり直し、0で止まり、離れるときに取り消す。
  useEffect(
    () =>
      flow.resendCooldown === 0 ? undefined : procedure.tickCooldown(dispatch),
    [flow.resendCooldown, procedure, dispatch],
  );
  const step = { procedure, copy, flow, view, siteKey };

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
      emailError={texts.fieldError("email", flow.fieldErrors.email)}
      captchaError={texts.fieldError("captcha", flow.fieldErrors.captcha)}
      submitting={flow.pending === "send"}
      error={texts.failure(flow.error)}
      hydrated={hydrated}
      siteKey={siteKey}
      onSubmit={(e) => {
        e.preventDefault();
        void procedure.sendCode({ email }, view);
      }}
      checkRef={check}
      onCheck={(token) => view.dispatch({ type: "captchaChecked", token })}
    />
  );
}

// コードの入力値は、この段階の中だけで持つ。戻ると段階ごと破棄され、入力値が残らない。
function CodeStep({
  procedure,
  copy,
  flow,
  view,
  siteKey,
  check,
  email,
}: StepProps & {
  check: RefObject<TurnstileInstance | undefined>;
  email: string;
}) {
  const texts = useAuthTexts();
  const [code, setCode] = useState("");
  const pending =
    flow.pending === "verify" || flow.pending === "send" ? flow.pending : null;
  return (
    <OtpCodeStep
      idPrefix={copy.idPrefix}
      email={email}
      note={copy.codeNote}
      code={code}
      onCodeChange={setCode}
      codeError={texts.fieldError("code", flow.fieldErrors.code)}
      resendError={texts.fieldError("resend", flow.fieldErrors.resend)}
      captchaError={texts.fieldError("captcha", flow.fieldErrors.captcha)}
      pending={pending}
      error={texts.failure(flow.error)}
      onBack={() => view.dispatch({ type: "emailStepReturned" })}
      onVerify={(e) => {
        e.preventDefault();
        void procedure.verifyCode({ email, code }, view);
      }}
      onResend={() => void procedure.sendCode({ email }, view)}
      siteKey={siteKey}
      checkRef={check}
      onCheck={(token) => view.dispatch({ type: "captchaChecked", token })}
      resendCooldown={flow.resendCooldown}
    />
  );
}

function PasswordStep({ procedure, copy, flow, view }: StepProps) {
  const t = useTranslations("auth");
  const texts = useAuthTexts();
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
        <AuthField
          errorId={errorId}
          error={texts.fieldError("password", flow.fieldErrors.password)}
        >
          {(aria) => (
            <PasswordInput
              placeholder={t("passwordFieldPlaceholder", {
                label: copy.passwordLabel,
                min: String(PASSWORD_MIN_LENGTH),
              })}
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
        <p className="text-center text-destructive text-sm">
          {texts.failure(flow.error)}
        </p>
      )}
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
