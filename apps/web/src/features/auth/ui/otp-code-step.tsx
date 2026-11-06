"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { useTranslations } from "next-intl";
import type { FormEvent, RefObject } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { Input } from "@/components/ui/input";
import { AUTH_CODE_LENGTH } from "../domain/auth-code";
import { AuthField } from "./auth-field";
import { AuthHeader } from "./auth-header";
import { Turnstile } from "./turnstile";

// 実行中の確認(verify)か、コードの送付(send。この段階では再送)。
type Pending = "verify" | "send" | null;

type OtpCodeStepProps = {
  // エラー文の要素のidの接頭辞(`${idPrefix}-code-error`)。
  idPrefix: string;
  email: string;
  // 迷惑メールの案内に続けて出す、画面ごとの案内(無ければ出さない)。
  note?: string;
  code: string;
  onCodeChange: (value: string) => void;
  codeError: string | undefined;
  resendError: string | undefined;
  // セキュリティチェックが未完了の不備。再送ボタンの下に出す。
  captchaError: string | undefined;
  // 実行中の確認か再送。どちらかが実行中の間は、3つのボタンを無効にする。
  pending: Pending;
  error: string | null;
  onBack: () => void;
  onVerify: (e: FormEvent<HTMLFormElement>) => void;
  onResend: () => void;
  siteKey: string;
  checkRef: RefObject<TurnstileInstance | undefined>;
  onCheck: (token: string | null) => void;
  resendCooldown: number;
};

export function OtpCodeStep({
  idPrefix,
  email,
  note,
  code,
  onCodeChange,
  codeError,
  resendError,
  captchaError,
  pending,
  error,
  onBack,
  onVerify,
  onResend,
  siteKey,
  checkRef,
  onCheck,
  resendCooldown,
}: OtpCodeStepProps) {
  const t = useTranslations("auth");
  return (
    <>
      <AuthHeader
        title={t("otpTitle")}
        description={t("otpDescription", { email })}
        onBack={onBack}
        backDisabled={pending !== null}
      />
      <CodeEntryForm
        code={code}
        onCodeChange={onCodeChange}
        error={codeError}
        pending={pending}
        errorId={`${idPrefix}-code-error`}
        onSubmit={onVerify}
      />
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      <p className="text-center text-muted-foreground text-sm">
        {t("otpSpamNote")}
      </p>
      {note && (
        <p className="text-center text-muted-foreground text-sm">{note}</p>
      )}
      <Turnstile siteKey={siteKey} ref={checkRef} onVerify={onCheck} />
      <ResendSection
        pending={pending}
        resendCooldown={resendCooldown}
        resendError={resendError}
        captchaError={captchaError}
        onResend={onResend}
      />
    </>
  );
}

function CodeEntryForm({
  code,
  onCodeChange,
  error,
  pending,
  errorId,
  onSubmit,
}: {
  code: string;
  onCodeChange: (value: string) => void;
  error: string | undefined;
  pending: Pending;
  errorId: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const t = useTranslations("auth");
  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-3">
      <AuthField errorId={errorId} error={error}>
        {(aria) => (
          <Input
            type="text"
            inputMode="numeric"
            placeholder={t("otpCodePlaceholder")}
            className="text-center tracking-widest"
            maxLength={AUTH_CODE_LENGTH}
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            {...aria}
          />
        )}
      </AuthField>
      <BusyButton
        type="submit"
        busy={pending !== null}
        spinner={pending === "verify"}
      >
        {t("otpVerify")}
      </BusyButton>
    </form>
  );
}

function ResendSection({
  pending,
  resendCooldown,
  resendError,
  captchaError,
  onResend,
}: {
  pending: Pending;
  resendCooldown: number;
  resendError: string | undefined;
  captchaError: string | undefined;
  onResend: () => void;
}) {
  const t = useTranslations("auth");
  return (
    <div className="flex w-full flex-col items-center gap-1">
      <BusyButton
        type="button"
        variant="outline"
        className="w-full"
        busy={pending !== null}
        spinner={pending === "send"}
        onClick={onResend}
      >
        {resendCooldown > 0
          ? t("otpResendWait", { seconds: String(resendCooldown) })
          : t("otpResend")}
      </BusyButton>
      {resendError && <p className="text-destructive text-sm">{resendError}</p>}
      {captchaError && (
        <p className="text-destructive text-sm">{captchaError}</p>
      )}
    </div>
  );
}
