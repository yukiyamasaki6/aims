"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import type { FormEvent, RefObject } from "react";
import { AuthHeader } from "@/components/auth-header";
import { Turnstile } from "@/components/turnstile";
import { BusyButton } from "@/components/ui/busy-button";
import { Input } from "@/components/ui/input";
import { AUTH_CODE_LENGTH } from "../domain/auth-code";
import { AuthField } from "./auth-field";

type Pending = "verify" | "resend" | null;

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
  onVerify: (e: FormEvent<HTMLFormElement>) => void;
  onResend: () => void;
  checkRef: RefObject<TurnstileInstance | undefined>;
  onCheck: (token: string | null) => void;
  // セキュリティチェックが完了している(トークンがある)か。
  checked: boolean;
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
  onVerify,
  onResend,
  checkRef,
  onCheck,
  checked,
  resendCooldown,
}: OtpCodeStepProps) {
  return (
    <>
      <AuthHeader
        title="認証コードを入力"
        description={`${email} に送信されたコードを入力してください。`}
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
        メールが届かない場合は、迷惑メールフォルダをご確認ください。
      </p>
      <Turnstile ref={checkRef} onVerify={onCheck} />
      <ResendSection
        pending={pending}
        checked={checked}
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
}: {
  code: string;
  onCodeChange: (value: string) => void;
  error: string | undefined;
  pending: Pending;
  errorId: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-3">
      <AuthField errorId={errorId} error={error}>
        {(aria) => (
          <Input
            type="text"
            inputMode="numeric"
            placeholder="123456"
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
        確認
      </BusyButton>
    </form>
  );
}

function ResendSection({
  pending,
  checked,
  resendCooldown,
  resendError,
  onResend,
}: {
  pending: Pending;
  checked: boolean;
  resendCooldown: number;
  resendError: string | undefined;
  onResend: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-1">
      <BusyButton
        type="button"
        variant="outline"
        className="w-full"
        busy={pending !== null}
        spinner={pending === "resend"}
        data-captcha-ready={checked}
        onClick={onResend}
      >
        {resendCooldown > 0 ? `再送（${resendCooldown}秒）` : "再送"}
      </BusyButton>
      {resendError && <p className="text-destructive text-sm">{resendError}</p>}
    </div>
  );
}
