"use client";

import { useTranslations } from "next-intl";
import { type RefObject, useEffect, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
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
import { AuthField } from "./auth-field";
import { AuthHeader } from "./auth-header";
import { OtpCodeStep } from "./otp-code-step";
import { OtpEmailStep } from "./otp-email-step";
import { PasswordInput } from "./password-input";
import { Turnstile, type TurnstileReset } from "./turnstile";
import { useAuthTexts } from "./use-auth-texts";
import { useCheckWait } from "./use-check-wait";
import { useScreenView } from "./use-screen-view";

// 画面ごとに違う文言。画面の配置にだけ関わるため、画面の部品が持つ。
export type PasswordSetupCopy = {
  // エラー文の要素のidの接頭辞。
  idPrefix: string;
  emailTitle: string;
  passwordTitle: string;
  // パスワード欄の見出し。説明(最小文字数など)は規則の持ち主から得て足す。
  passwordLabel: string;
  passwordSubmit: string;
};

// チェックを待つ操作の、押した時点の入力。コードの送付(初回と再送)とパスワードの設定(サインアップ)が待つ。
type CheckedInput =
  | { kind: "sendCode"; email: string }
  | { kind: "setPassword"; email: string; password: string };

type StepProps = {
  procedure: PasswordSetup;
  copy: PasswordSetupCopy;
  flow: PasswordSetupFlow;
  view: ScreenView<PasswordSetupFlow, PasswordSetupEvent>;
  siteKey: string;
  run: (input: CheckedInput) => void;
  checkProps: ReturnType<typeof useCheckWait>["checkProps"];
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
  const { run, checkProps } = useCheckWait({
    flow,
    dispatch,
    resume: (input: CheckedInput) =>
      void (input.kind === "sendCode"
        ? procedure.sendCode({ email: input.email }, view)
        : procedure.setPassword(
            { email: input.email, password: input.password },
            view,
          )),
  });
  // 残りが変わるたびに1秒の予約をやり直し、0で止まり、離れるときに取り消す。
  useEffect(
    () =>
      flow.resendCooldown === 0 ? undefined : procedure.tickCooldown(dispatch),
    [flow.resendCooldown, procedure, dispatch],
  );
  const step = { procedure, copy, flow, view, siteKey, run, checkProps };

  if (flow.step === "password")
    return <PasswordStep {...step} check={check} email={email} />;
  if (flow.step === "code")
    return <CodeStep {...step} check={check} email={email} />;
  return (
    <OtpEmailStep
      idPrefix={copy.idPrefix}
      title={copy.emailTitle}
      email={email}
      onEmailChange={setEmail}
      emailError={texts.fieldError("email", flow.fieldErrors.email)}
      submitting={flow.pending === "send"}
      error={texts.screenError(flow.error, flow.fieldErrors.captcha)}
      hydrated={hydrated}
      siteKey={siteKey}
      onSubmit={(e) => {
        e.preventDefault();
        run({ kind: "sendCode", email });
      }}
      checkRef={check}
      onCheck={(token) => view.dispatch({ type: "captchaChecked", token })}
      {...checkProps}
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
  run,
  checkProps,
  check,
  email,
}: StepProps & {
  check: RefObject<TurnstileReset | undefined>;
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
      code={code}
      onCodeChange={setCode}
      codeError={texts.fieldError("code", flow.fieldErrors.code)}
      resendError={texts.fieldError("resend", flow.fieldErrors.resend)}
      pending={pending}
      error={texts.screenError(flow.error, flow.fieldErrors.captcha)}
      onBack={() => view.dispatch({ type: "emailStepReturned" })}
      onVerify={(e) => {
        e.preventDefault();
        void procedure.verifyCode({ email, code }, view);
      }}
      onResend={() => {
        run({ kind: "sendCode", email });
      }}
      siteKey={siteKey}
      checkRef={check}
      onCheck={(token) => view.dispatch({ type: "captchaChecked", token })}
      {...checkProps}
      resendCooldown={flow.resendCooldown}
    />
  );
}

// パスワード設定の段階。チェックを要する手続き(サインアップ)だけが、この段階のウィジェットでトークンを取り直す。
function PasswordStep({
  procedure,
  copy,
  flow,
  view,
  siteKey,
  run,
  checkProps,
  check,
  email,
}: StepProps & {
  check: RefObject<TurnstileReset | undefined>;
  email: string;
}) {
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  const errorText = texts.screenError(flow.error, flow.fieldErrors.captcha);
  const [password, setPassword] = useState("");
  const submitting = flow.pending === "setPassword";
  const errorId = `${copy.idPrefix}-password-error`;
  return (
    <>
      <AuthHeader title={copy.passwordTitle} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run({ kind: "setPassword", email, password });
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
              name="password"
              autoComplete="new-password"
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
        {procedure.requiresCheck && (
          <Turnstile
            siteKey={siteKey}
            ref={check}
            onVerify={(token) =>
              view.dispatch({ type: "captchaChecked", token })
            }
            {...checkProps}
          />
        )}
        <BusyButton type="submit" busy={submitting}>
          {copy.passwordSubmit}
        </BusyButton>
      </form>
      {errorText && (
        <p className="text-center text-destructive text-sm">{errorText}</p>
      )}
    </>
  );
}
