"use client";

import { useTranslations } from "next-intl";
import type { FormEvent, ReactNode, RefObject } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { Turnstile, type TurnstileReset } from "./turnstile";

// メール確認コードの送信の操作(セキュリティチェック、送信ボタン、再送待機の失敗、画面の失敗)。入力欄があれば、子に置く。
export function OtpSendForm({
  children,
  onSubmit,
  hydrated,
  siteKey,
  checkRef,
  onCheck,
  onFailed,
  waiting,
  submitting,
  label,
  variant,
  resendCooldown,
  resendError,
  error,
}: {
  children?: ReactNode;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  hydrated: boolean;
  siteKey: string;
  checkRef: RefObject<TurnstileReset | undefined>;
  onCheck: (token: string | null) => void;
  onFailed: () => void;
  waiting: boolean;
  submitting: boolean;
  // 再送待機でないときの送信ボタンの文言。
  label: string;
  variant: "default" | "destructive";
  resendCooldown: number;
  resendError: string | undefined;
  error: string | null;
}) {
  const t = useTranslations("auth");
  return (
    <>
      <form
        onSubmit={onSubmit}
        noValidate
        data-hydrated={hydrated}
        className="flex w-full flex-col gap-3"
      >
        {children}
        <Turnstile
          siteKey={siteKey}
          ref={checkRef}
          onVerify={onCheck}
          onFailed={onFailed}
          waiting={waiting}
        />
        <BusyButton type="submit" variant={variant} busy={submitting}>
          {resendCooldown > 0
            ? t("otpResendWait", { seconds: String(resendCooldown) })
            : label}
        </BusyButton>
        {resendError && (
          <p className="text-destructive text-sm">{resendError}</p>
        )}
      </form>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
    </>
  );
}
