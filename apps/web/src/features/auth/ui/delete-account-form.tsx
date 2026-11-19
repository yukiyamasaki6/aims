"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ScreenFrame } from "@/components/screen-frame";
import { BusyButton } from "@/components/ui/busy-button";
import { useHydrated } from "@/hooks/use-hydrated";
import type { DeleteAccount } from "../application/delete-account";
import { RESEND_COOLDOWN_SECONDS } from "../domain/auth-code";
import {
  type DeleteAccountEvent,
  type DeleteAccountFlow,
  deleteAccountReducer,
  initialDeleteAccountFlow,
} from "../domain/delete-account-flow";
import { OtpCodeStep } from "./otp-code-step";
import { SettingsBackLink } from "./settings-back-link";
import { Turnstile } from "./turnstile";
import { useAuthTexts } from "./use-auth-texts";
import { useCheckWait } from "./use-check-wait";
import { useScreenView } from "./use-screen-view";

export function DeleteAccountForm({
  deleteAccount,
  siteKey,
  onBack,
  onBusyChange,
}: {
  deleteAccount: DeleteAccount;
  siteKey: string;
  onBack: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const screen = useScreenView(deleteAccountReducer, initialDeleteAccountFlow);
  const { state: flow, view } = screen;
  const [code, setCode] = useState("");
  const { run, checkProps } = useCheckWait({
    flow,
    dispatch: view.dispatch,
    resume: () => void deleteAccount.sendCode(view),
  });
  useEffect(
    () => onBusyChange(flow.submitting),
    [flow.submitting, onBusyChange],
  );
  useEffect(
    () =>
      flow.resendCooldown === 0
        ? undefined
        : deleteAccount.tickCooldown(view.dispatch),
    [flow.resendCooldown, deleteAccount, view.dispatch],
  );
  useEffect(() => {
    if (flow.step !== "code" || flow.resendCooldown === RESEND_COOLDOWN_SECONDS)
      setCode("");
  }, [flow.step, flow.resendCooldown]);
  const t = useTranslations("auth");
  return (
    <ScreenFrame
      title={t("deleteAccountTitle")}
      leading={<SettingsBackLink disabled={flow.submitting} onBack={onBack} />}
    >
      <div className="h-full overflow-y-auto">
        <main className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-4 p-8">
          <DeleteAccountNotice />
          <DeleteAccountStep
            screen={screen}
            deleteAccount={deleteAccount}
            siteKey={siteKey}
            code={code}
            setCode={setCode}
            run={() => run(undefined)}
            checkProps={checkProps}
          />
        </main>
      </div>
    </ScreenFrame>
  );
}

type StepProps = {
  screen: ReturnType<
    typeof useScreenView<DeleteAccountFlow, DeleteAccountEvent>
  >;
  deleteAccount: DeleteAccount;
  siteKey: string;
  code: string;
  setCode: (code: string) => void;
  run: () => void;
  checkProps: ReturnType<typeof useCheckWait>["checkProps"];
};

function DeleteAccountStep(props: StepProps) {
  return props.screen.state.step === "code" ? (
    <DeleteAccountCodeStep {...props} />
  ) : (
    <DeleteAccountRequestStep {...props} />
  );
}

function DeleteAccountCodeStep({
  screen: { state: flow, view, checkRef },
  deleteAccount,
  siteKey,
  code,
  setCode,
  run,
  checkProps,
}: StepProps) {
  const texts = useAuthTexts();
  const error = texts.screenError(flow.error, flow.fieldErrors.captcha);
  return (
    <OtpCodeStep
      idPrefix="delete-account"
      email={flow.email}
      code={code}
      onCodeChange={setCode}
      codeError={texts.fieldError("code", flow.fieldErrors.code)}
      resendError={texts.fieldError("resend", flow.fieldErrors.resend)}
      pending={flow.pending === "delete" ? "verify" : flow.pending}
      error={error}
      destructive
      onVerify={(event) => {
        event.preventDefault();
        void deleteAccount.verifyCode({ code }, view);
      }}
      onResend={run}
      siteKey={siteKey}
      checkRef={checkRef}
      onCheck={(token) => view.dispatch({ type: "captchaChecked", token })}
      {...checkProps}
      resendCooldown={flow.resendCooldown}
    />
  );
}

function DeleteAccountRequestStep({
  screen: { state: flow, view, checkRef },
  deleteAccount,
  siteKey,
  run,
  checkProps,
}: StepProps) {
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  const hydrated = useHydrated();
  const error = texts.screenError(flow.error, flow.fieldErrors.captcha);
  return (
    <>
      {flow.step === "request" && (
        <p className="text-sm">
          {t("changeEmailCurrent", { email: flow.email })}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (flow.step === "confirmation") void deleteAccount.submit(view);
          else run();
        }}
        noValidate
        data-hydrated={hydrated}
        className="flex w-full flex-col gap-3"
      >
        {flow.step === "request" && (
          <Turnstile
            siteKey={siteKey}
            ref={checkRef}
            onVerify={(token) =>
              view.dispatch({ type: "captchaChecked", token })
            }
            {...checkProps}
          />
        )}
        <BusyButton
          type="submit"
          variant={flow.step === "confirmation" ? "destructive" : "default"}
          busy={flow.submitting}
        >
          {flow.step === "confirmation"
            ? t("deleteAccountSubmit")
            : t("otpSendCode")}
        </BusyButton>
      </form>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
    </>
  );
}

function DeleteAccountNotice() {
  const t = useTranslations("auth");
  return (
    <div className="flex w-full flex-col gap-2 text-sm">
      <p className="font-medium text-destructive">
        {t("deleteAccountIrreversible")}
      </p>
      <ul className="list-disc pl-5">
        <li>{t("deleteAccountItemRelated")}</li>
        <li>{t("deleteAccountItemOthersRemain")}</li>
        <li>{t("deleteAccountItemDuration")}</li>
      </ul>
      <p>{t("deleteAccountPrompt")}</p>
    </div>
  );
}
