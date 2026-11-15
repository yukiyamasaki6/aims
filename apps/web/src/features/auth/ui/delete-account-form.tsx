"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect } from "react";
import { ScreenFrame } from "@/components/screen-frame";
import { BusyButton } from "@/components/ui/busy-button";
import { useHydrated } from "@/hooks/use-hydrated";
import type { DeleteAccount } from "../application/delete-account";
import {
  deleteAccountReducer,
  initialDeleteAccountFlow,
} from "../domain/delete-account-flow";
import { AuthField } from "./auth-field";
import { PasswordInput } from "./password-input";
import { SettingsBackLink } from "./settings-back-link";
import { Turnstile } from "./turnstile";
import { useAuthTexts } from "./use-auth-texts";
import { useScreenView } from "./use-screen-view";

// エラー文の要素のidの接頭辞(`${ID_PREFIX}-current-password-error`)。
const ID_PREFIX = "delete-account";

// アカウント削除の画面。削除される内容と取り消せないことを示し、現在のパスワードの確認で削除する。成功は遷移まで処理中のままで、失敗は理由を示して入力へ戻る。ヘッダーの戻るは処理中だけ押せない。
// onBack: 設定パネルの分類「アカウント」へ戻る。onBusyChange: 送信中かを設定パネルへ知らせる(成功の後は遷移まで送信中のまま)。
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
  const {
    state: flow,
    view,
    checkRef,
  } = useScreenView(deleteAccountReducer, initialDeleteAccountFlow);
  const hydrated = useHydrated();
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  useEffect(
    () => onBusyChange(flow.submitting),
    [flow.submitting, onBusyChange],
  );

  // 値は送信時に読む(入力欄は制御しない)。
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void deleteAccount.submit({ password: String(data.get("password")) }, view);
  }

  return (
    <ScreenFrame
      title={t("deleteAccountTitle")}
      leading={<SettingsBackLink disabled={flow.submitting} onBack={onBack} />}
    >
      <div className="h-full overflow-y-auto">
        <main className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-4 p-8">
          <DeleteAccountNotice />
          <form
            onSubmit={onSubmit}
            noValidate
            data-hydrated={hydrated}
            className="flex w-full flex-col gap-3"
          >
            <AuthField
              errorId={`${ID_PREFIX}-current-password-error`}
              error={texts.fieldError(
                "currentPassword",
                flow.fieldErrors.currentPassword,
              )}
            >
              {(aria) => (
                <PasswordInput
                  name="password"
                  autoComplete="current-password"
                  placeholder={t("deleteAccountPasswordPlaceholder")}
                  {...aria}
                />
              )}
            </AuthField>
            <Turnstile
              siteKey={siteKey}
              ref={checkRef}
              onVerify={(token) =>
                view.dispatch({ type: "captchaChecked", token })
              }
              error={texts.fieldError("captcha", flow.fieldErrors.captcha)}
            />
            <BusyButton
              type="submit"
              variant="destructive"
              busy={flow.submitting}
            >
              {t("deleteAccountSubmit")}
            </BusyButton>
          </form>
          {flow.error && (
            <p className="text-center text-destructive text-sm">
              {texts.failure(flow.error)}
            </p>
          )}
        </main>
      </div>
    </ScreenFrame>
  );
}

// 削除が取り消せないことと、削除される内容。
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
