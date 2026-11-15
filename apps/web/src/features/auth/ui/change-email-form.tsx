"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useId,
  useState,
} from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { Input } from "@/components/ui/input";
import { useHydrated } from "@/hooks/use-hydrated";
import type { ChangeEmail, ChangeEmailView } from "../application/change-email";
import { AUTH_CODE_LENGTH } from "../domain/auth-code";
import {
  type ChangeEmailFlow,
  type CodeField as CodeFieldName,
  changeEmailReducer,
  initialChangeEmailFlow,
} from "../domain/change-email-flow";
import { AuthField } from "./auth-field";
import { AuthHeader } from "./auth-header";
import { ResendSection } from "./otp-code-step";
import { Turnstile } from "./turnstile";
import { useAuthTexts } from "./use-auth-texts";
import { useScreenView } from "./use-screen-view";

// エラー文の要素のidの接頭辞(`${ID_PREFIX}-email-error`)。
const ID_PREFIX = "change-email";

// メールアドレス変更の画面。入力とコード確認の2段階で、完了では見出しと設定へ戻る操作と完了の文言だけを描き、画面に留まる。
export function ChangeEmailForm({
  changeEmail,
  siteKey,
}: {
  changeEmail: ChangeEmail;
  siteKey: string;
}) {
  const {
    state: flow,
    view,
    checkRef,
  } = useScreenView(changeEmailReducer, initialChangeEmailFlow);
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  const { dispatch, isMounted } = view;
  // 開いたときに現在のメールアドレスを読む(表示だけに使う)。
  useEffect(() => {
    void changeEmail.load({ dispatch, isMounted });
  }, [changeEmail, dispatch, isMounted]);
  // 残りが変わるたびに1秒の予約をやり直し、0で止まり、離れるときに取り消す。
  useEffect(
    () =>
      flow.resendCooldown === 0
        ? undefined
        : changeEmail.tickCooldown(dispatch),
    [flow.resendCooldown, changeEmail, dispatch],
  );
  const [email, setEmail] = useState("");
  // 完了では、見出しと設定へ戻る操作と完了の文言だけを描く。
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-4 p-8">
      {flow.completed ? (
        <AuthHeader
          title={t("changeEmailTitle")}
          onBack={() => changeEmail.leave()}
        />
      ) : flow.step === "email" ? (
        <EmailStep
          changeEmail={changeEmail}
          flow={flow}
          view={view}
          email={email}
          onEmailChange={setEmail}
        />
      ) : (
        <CodeStep
          changeEmail={changeEmail}
          flow={flow}
          view={view}
          siteKey={siteKey}
          checkRef={checkRef}
        />
      )}
      {flow.error && (
        <p className="text-center text-destructive text-sm">
          {texts.failure(flow.error)}
        </p>
      )}
      {/* 領域は常に描画し、完了の文言だけを差し込む(後から挿入された領域は、読み上げられない場合があるため)。 */}
      <p role="status" className="text-center text-sm">
        {flow.completed ? t("changeEmailDone") : null}
      </p>
    </main>
  );
}

// コード確認の段階。2つの欄を1つのフォームで出し、値を変えた欄をまとめて確認する。
function CodeStep({
  changeEmail,
  flow,
  view,
  siteKey,
  checkRef,
}: {
  changeEmail: ChangeEmail;
  flow: ChangeEmailFlow;
  view: ChangeEmailView;
  siteKey: string;
  checkRef: RefObject<TurnstileInstance | undefined>;
}) {
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  const busy = flow.pending !== null;
  return (
    <>
      <AuthHeader
        title={t("changeEmailTitle")}
        description={t("changeEmailCodeDescription")}
        onBack={() => view.dispatch({ type: "backed" })}
        backDisabled={busy}
      />
      <CodeForm changeEmail={changeEmail} flow={flow} view={view} />
      <p className="text-center text-muted-foreground text-sm">
        {t("otpSpamNote")}
      </p>
      <Turnstile
        siteKey={siteKey}
        ref={checkRef}
        onVerify={(token) => view.dispatch({ type: "captchaChecked", token })}
      />
      <ResendSection
        pending={
          flow.pending === null
            ? null
            : flow.pending === "resend"
              ? "send"
              : "verify"
        }
        resendCooldown={flow.resendCooldown}
        resendError={texts.fieldError("resend", flow.fieldErrors.resend)}
        captchaError={texts.fieldError("captcha", flow.fieldErrors.captcha)}
        onResend={() => void changeEmail.resend(view)}
      />
    </>
  );
}

// 2つのコード欄と確認ボタン1つのフォーム。
// 値は制御せず、送信時に読む。欄は、要求と再送の受け付けごと(世代が進むごと)に作り直し、空にする。失敗では作り直さず、入力が保たれる。
function CodeForm({
  changeEmail,
  flow,
  view,
}: {
  changeEmail: ChangeEmail;
  flow: ChangeEmailFlow;
  view: ChangeEmailView;
}) {
  const t = useTranslations("auth");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void changeEmail.confirm(
      {
        codes: {
          currentCode: String(data.get("currentCode")),
          newCode: String(data.get("newCode")),
        },
      },
      view,
    );
  }
  return (
    <form
      key={flow.generation}
      onSubmit={submit}
      noValidate
      className="flex w-full flex-col gap-3"
    >
      <CodeField
        field="currentCode"
        label={t("changeEmailCurrentCodeLabel", {
          email: flow.currentEmail ?? "",
        })}
        flow={flow}
      />
      <CodeField
        field="newCode"
        label={t("changeEmailNewCodeLabel", { email: flow.newEmail ?? "" })}
        flow={flow}
      />
      <BusyButton
        type="submit"
        busy={flow.pending !== null}
        spinner={flow.pending === "confirm"}
      >
        {t("otpVerify")}
      </BusyButton>
    </form>
  );
}

// 1つのコード欄。
function CodeField({
  field,
  label,
  flow,
}: {
  field: CodeFieldName;
  label: string;
  flow: ChangeEmailFlow;
}) {
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  const inputId = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="break-all text-sm font-medium">
        {label}
      </label>
      <AuthField
        errorId={`${ID_PREFIX}-${field}-error`}
        error={texts.fieldError(field, flow.fieldErrors[field])}
      >
        {(aria) => (
          <Input
            id={inputId}
            type="text"
            inputMode="numeric"
            name={field}
            autoComplete="one-time-code"
            placeholder={t("otpCodePlaceholder")}
            className="text-center tracking-widest"
            maxLength={AUTH_CODE_LENGTH}
            {...aria}
          />
        )}
      </AuthField>
    </div>
  );
}

function EmailStep({
  changeEmail,
  flow,
  view,
  email,
  onEmailChange,
}: {
  changeEmail: ChangeEmail;
  flow: ChangeEmailFlow;
  view: ChangeEmailView;
  email: string;
  onEmailChange: (value: string) => void;
}) {
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  const hydrated = useHydrated();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void changeEmail.request({ email }, view);
  }

  return (
    <>
      <AuthHeader
        title={t("changeEmailTitle")}
        description={
          flow.currentEmail === null
            ? undefined
            : t("changeEmailCurrent", { email: flow.currentEmail })
        }
      />
      <form
        onSubmit={submit}
        noValidate
        data-hydrated={hydrated}
        className="flex w-full flex-col gap-3"
      >
        <AuthField
          errorId={`${ID_PREFIX}-email-error`}
          error={texts.fieldError("email", flow.fieldErrors.email)}
        >
          {(aria) => (
            <Input
              type="email"
              name="email"
              autoComplete="email"
              placeholder={t("changeEmailNewPlaceholder")}
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              {...aria}
            />
          )}
        </AuthField>
        <BusyButton type="submit" busy={flow.pending === "request"}>
          {t("otpSendCode")}
        </BusyButton>
      </form>
    </>
  );
}
