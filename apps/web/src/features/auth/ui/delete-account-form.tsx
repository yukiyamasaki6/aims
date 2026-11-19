"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ScreenFrame } from "@/components/screen-frame";
import { useHydrated } from "@/hooks/use-hydrated";
import type { DeleteAccount } from "../application/delete-account";
import {
  type DeleteAccountEvent,
  type DeleteAccountFlow,
  deleteAccountReducer,
  initialDeleteAccountFlow,
} from "../domain/delete-account-flow";
import { FlowOtpCodeStep } from "./flow-otp-code-step";
import { OtpSendForm } from "./otp-send-form";
import { SettingsBackLink } from "./settings-back-link";
import { useAuthTexts } from "./use-auth-texts";
import { useCheckWait } from "./use-check-wait";
import { useResendCooldownTick } from "./use-code-entry";
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
  const { run, checkProps } = useCheckWait({
    flow,
    dispatch: view.dispatch,
    resume: () => void deleteAccount.sendCode(view),
  });
  const busy = flow.pending !== null;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useResendCooldownTick(
    flow.resendCooldown,
    deleteAccount.tickCooldown,
    view.dispatch,
  );
  const t = useTranslations("auth");
  return (
    <ScreenFrame
      title={t("deleteAccountTitle")}
      leading={<SettingsBackLink disabled={busy} onBack={onBack} />}
    >
      <div className="h-full overflow-y-auto">
        <main className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-4 p-8">
          {flow.step === "code" ? (
            <FlowOtpCodeStep
              idPrefix="delete-account"
              email={flow.email}
              screen={screen}
              siteKey={siteKey}
              checkProps={checkProps}
              verifyLabel={t("deleteAccountVerify")}
              verifyVariant="destructive"
              onVerify={(code) => void deleteAccount.verifyCode({ code }, view)}
              onResend={() => run(undefined)}
            />
          ) : (
            <DeleteAccountConfirmation
              screen={screen}
              siteKey={siteKey}
              checkProps={checkProps}
              run={() => run(undefined)}
            />
          )}
        </main>
      </div>
    </ScreenFrame>
  );
}

function DeleteAccountConfirmation({
  screen: { state: flow, view, checkRef },
  siteKey,
  checkProps,
  run,
}: {
  screen: ReturnType<
    typeof useScreenView<DeleteAccountFlow, DeleteAccountEvent>
  >;
  siteKey: string;
  checkProps: ReturnType<typeof useCheckWait>["checkProps"];
  run: () => void;
}) {
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  const hydrated = useHydrated();
  return (
    <>
      <DeleteAccountNotice />
      <OtpSendForm
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
        hydrated={hydrated}
        siteKey={siteKey}
        checkRef={checkRef}
        onCheck={(token) => view.dispatch({ type: "captchaChecked", token })}
        {...checkProps}
        submitting={flow.pending !== null}
        label={t("deleteAccountSubmit")}
        variant="destructive"
        resendCooldown={flow.resendCooldown}
        resendError={texts.fieldError("resend", flow.fieldErrors.resend)}
        error={texts.screenError(flow.error, flow.fieldErrors.captcha)}
      />
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
