"use client";

import { useTranslations } from "next-intl";
import type { FormEvent, RefObject } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { Input } from "@/components/ui/input";
import { AUTH_CODE_LENGTH } from "../domain/auth-code";
import { AuthField } from "./auth-field";
import { AuthHeader } from "./auth-header";
import { Turnstile, type TurnstileReset } from "./turnstile";

// 実行中の確認(verify)か、コードの送付(send。この段階では再送)。
type Pending = "verify" | "send" | null;

type OtpCodeStepProps = {
  // エラー文の要素のidの接頭辞(`${idPrefix}-code-error`)。
  idPrefix: string;
  email: string;
  code: string;
  onCodeChange: (value: string) => void;
  codeError: string | undefined;
  resendError: string | undefined;
  // 実行中の確認か再送。どちらかが実行中の間は、3つのボタンを無効にする。
  pending: Pending;
  error: string | null;
  onBack: () => void;
  // 確認ボタンの文言と見た目。
  verifyLabel: string;
  verifyVariant: "default" | "destructive";
  onVerify: (e: FormEvent<HTMLFormElement>) => void;
  onResend: () => void;
  siteKey: string;
  checkRef: RefObject<TurnstileReset | undefined>;
  onCheck: (token: string | null) => void;
  onFailed: () => void;
  waiting: boolean;
  resendCooldown: number;
};

export function OtpCodeStep({
  idPrefix,
  email,
  code,
  onCodeChange,
  codeError,
  resendError,
  pending,
  error,
  onBack,
  verifyLabel,
  verifyVariant,
  onVerify,
  onResend,
  siteKey,
  checkRef,
  onCheck,
  onFailed,
  waiting,
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
        verifyLabel={verifyLabel}
        verifyVariant={verifyVariant}
      />
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      <p className="text-center text-muted-foreground text-sm">
        {t("otpSpamNote")}
      </p>
      <Turnstile
        siteKey={siteKey}
        ref={checkRef}
        onVerify={onCheck}
        onFailed={onFailed}
        waiting={waiting}
      />
      <ResendSection
        pending={pending}
        resendCooldown={resendCooldown}
        resendError={resendError}
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
  verifyLabel,
  verifyVariant,
}: {
  code: string;
  onCodeChange: (value: string) => void;
  error: string | undefined;
  pending: Pending;
  errorId: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  verifyLabel: string;
  verifyVariant: "default" | "destructive";
}) {
  const t = useTranslations("auth");
  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-3">
      <AuthField errorId={errorId} error={error}>
        {(aria) => (
          <Input
            type="text"
            inputMode="numeric"
            name="code"
            autoComplete="one-time-code"
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
        variant={verifyVariant}
        busy={pending !== null}
        spinner={pending === "verify"}
      >
        {verifyLabel}
      </BusyButton>
    </form>
  );
}

export function ResendSection({
  pending,
  resendCooldown,
  resendError,
  onResend,
}: {
  pending: Pending;
  resendCooldown: number;
  resendError: string | undefined;
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
    </div>
  );
}
