"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { Loader2 } from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { AuthHeader } from "@/components/auth-header";
import { Turnstile } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AUTH_CODE_LENGTH } from "../domain/auth-code";

type Pending = "verify" | "resend" | null;
type FieldErrors = { code?: string; resend?: string };

type OtpCodeStepProps = {
  // エラー文の要素のidの接頭辞(`${idPrefix}-code-error`)。
  idPrefix: string;
  email: string;
  code: string;
  onCodeChange: (value: string) => void;
  fieldErrors: FieldErrors;
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
  fieldErrors,
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
        fieldErrors={fieldErrors}
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
        resendError={fieldErrors.resend}
        onResend={onResend}
      />
    </>
  );
}

function CodeEntryForm({
  code,
  onCodeChange,
  fieldErrors,
  pending,
  errorId,
  onSubmit,
}: {
  code: string;
  onCodeChange: (value: string) => void;
  fieldErrors: FieldErrors;
  pending: Pending;
  errorId: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Input
          type="text"
          inputMode="numeric"
          placeholder="123456"
          className="text-center tracking-widest"
          maxLength={AUTH_CODE_LENGTH}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          aria-invalid={Boolean(fieldErrors.code)}
          aria-describedby={fieldErrors.code ? errorId : undefined}
        />
        {fieldErrors.code && (
          <p id={errorId} className="text-destructive text-sm">
            {fieldErrors.code}
          </p>
        )}
      </div>
      <Button
        type="submit"
        aria-disabled={pending !== null}
        className={cn(pending !== null && "pointer-events-none opacity-50")}
      >
        {pending === "verify" && <Loader2 className="size-3.5 animate-spin" />}
        確認
      </Button>
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
      <Button
        type="button"
        variant="outline"
        className={cn(
          "w-full",
          pending !== null && "pointer-events-none opacity-50",
        )}
        aria-disabled={pending !== null}
        data-captcha-ready={checked}
        onClick={onResend}
      >
        {pending === "resend" && <Loader2 className="size-3.5 animate-spin" />}
        {resendCooldown > 0 ? `再送（${resendCooldown}秒）` : "再送"}
      </Button>
      {resendError && <p className="text-destructive text-sm">{resendError}</p>}
    </div>
  );
}
