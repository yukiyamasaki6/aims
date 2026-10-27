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

// 部品が使う項目だけを構造で定める。各画面のフォームの状態はこの形を満たす。
export type OtpCodeStepModel = {
  email: string;
  code: string;
  setCode: (value: string) => void;
  codeFieldErrors: { code?: string; resend?: string };
  codeStepPending: "verify" | "resend" | null;
  error: string | null;
  handleBack: () => void;
  handleVerifyCode: (e: FormEvent<HTMLFormElement>) => void;
  handleResend: () => void;
  turnstileRef: RefObject<TurnstileInstance | undefined>;
  setCaptchaToken: (token: string | null) => void;
  captchaToken: string | null;
  resendCooldown: number;
};

export function OtpCodeStep({
  form,
  idPrefix,
}: {
  form: OtpCodeStepModel;
  // エラー文の要素のidの接頭辞(`${idPrefix}-code-error`)。
  idPrefix: string;
}) {
  const {
    email,
    code,
    setCode,
    codeFieldErrors,
    codeStepPending,
    error,
    handleBack,
    handleVerifyCode,
    handleResend,
    turnstileRef,
    setCaptchaToken,
    captchaToken,
    resendCooldown,
  } = form;
  return (
    <>
      <AuthHeader
        title="認証コードを入力"
        description={`${email} に送信されたコードを入力してください。`}
        onBack={handleBack}
        backDisabled={codeStepPending !== null}
      />
      <CodeEntryForm
        code={code}
        setCode={setCode}
        codeFieldErrors={codeFieldErrors}
        codeStepPending={codeStepPending}
        errorId={`${idPrefix}-code-error`}
        onSubmit={handleVerifyCode}
      />
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
      <p className="text-center text-muted-foreground text-sm">
        メールが届かない場合は、迷惑メールフォルダをご確認ください。
      </p>
      <Turnstile ref={turnstileRef} onVerify={setCaptchaToken} />
      <ResendSection
        codeStepPending={codeStepPending}
        captchaToken={captchaToken}
        resendCooldown={resendCooldown}
        resendError={codeFieldErrors.resend}
        onResend={handleResend}
      />
    </>
  );
}

function CodeEntryForm({
  code,
  setCode,
  codeFieldErrors,
  codeStepPending,
  errorId,
  onSubmit,
}: {
  code: string;
  setCode: (value: string) => void;
  codeFieldErrors: OtpCodeStepModel["codeFieldErrors"];
  codeStepPending: OtpCodeStepModel["codeStepPending"];
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
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={Boolean(codeFieldErrors.code)}
          aria-describedby={codeFieldErrors.code ? errorId : undefined}
        />
        {codeFieldErrors.code && (
          <p id={errorId} className="text-destructive text-sm">
            {codeFieldErrors.code}
          </p>
        )}
      </div>
      <Button
        type="submit"
        aria-disabled={codeStepPending !== null}
        className={cn(
          codeStepPending !== null && "pointer-events-none opacity-50",
        )}
      >
        {codeStepPending === "verify" && (
          <Loader2 className="size-3.5 animate-spin" />
        )}
        確認
      </Button>
    </form>
  );
}

function ResendSection({
  codeStepPending,
  captchaToken,
  resendCooldown,
  resendError,
  onResend,
}: {
  codeStepPending: OtpCodeStepModel["codeStepPending"];
  captchaToken: string | null;
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
          codeStepPending !== null && "pointer-events-none opacity-50",
        )}
        aria-disabled={codeStepPending !== null}
        data-captcha-ready={captchaToken !== null}
        onClick={onResend}
      >
        {codeStepPending === "resend" && (
          <Loader2 className="size-3.5 animate-spin" />
        )}
        {resendCooldown > 0 ? `再送（${resendCooldown}秒）` : "再送"}
      </Button>
      {resendError && <p className="text-destructive text-sm">{resendError}</p>}
    </div>
  );
}
