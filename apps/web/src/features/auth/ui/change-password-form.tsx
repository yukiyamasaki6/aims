"use client";

import { useTranslations } from "next-intl";
import type { FormEvent } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { useHydrated } from "@/hooks/use-hydrated";
import type { ChangePassword } from "../application/change-password";
import {
  type ChangePasswordFlow,
  changePasswordReducer,
  initialChangePasswordFlow,
} from "../domain/change-password-flow";
import { AuthField } from "./auth-field";
import { PasswordInput } from "./password-input";
import { useAuthTexts } from "./use-auth-texts";
import { useScreenView } from "./use-screen-view";

// エラー文の要素のidの接頭辞(`${ID_PREFIX}-current-password-error`)。
const ID_PREFIX = "change-password";

// パスワード変更の画面。完了で入力欄を作り直して値を消し、画面に留まる。
export function ChangePasswordForm({
  changePassword,
}: {
  changePassword: ChangePassword;
}) {
  const { state: flow, view } = useScreenView(
    changePasswordReducer,
    initialChangePasswordFlow,
  );
  const hydrated = useHydrated();
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-4 p-8">
      <h1 className="font-heading text-2xl leading-snug font-medium">
        {t("changePasswordTitle")}
      </h1>
      <ChangePasswordFields
        flow={flow}
        hydrated={hydrated}
        onSubmit={(input) => void changePassword.submit(input, view)}
      />
      {flow.error && (
        <p className="text-center text-destructive text-sm">
          {texts.failure(flow.error)}
        </p>
      )}
      {/* 領域は常に描画し、完了の文言だけを差し込む(後から挿入された領域は、読み上げられない場合があるため)。 */}
      <p role="status" className="text-center text-sm">
        {flow.completed ? t("changePasswordDone") : null}
      </p>
    </main>
  );
}

function ChangePasswordFields({
  flow,
  hydrated,
  onSubmit,
}: {
  flow: ChangePasswordFlow;
  hydrated: boolean;
  onSubmit: (input: { currentPassword: string; newPassword: string }) => void;
}) {
  const t = useTranslations("auth");
  const texts = useAuthTexts();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    onSubmit({
      currentPassword: String(data.get("currentPassword")),
      newPassword: String(data.get("newPassword")),
    });
  }

  // 入力欄は、完了のたびに作り直し、入力値と表示の切り替えを初期に戻す。
  // フォームと送信ボタンは作り直さず、フォーカスを保つ。値は送信時に読む(入力欄は制御しない。2つの欄は常に存在するため、取得の結果は文字列である)。
  return (
    <form
      onSubmit={submit}
      noValidate
      data-hydrated={hydrated}
      className="flex w-full flex-col gap-3"
    >
      <AuthField
        key={`current-${flow.completions}`}
        errorId={`${ID_PREFIX}-current-password-error`}
        error={texts.fieldError(
          "currentPassword",
          flow.fieldErrors.currentPassword,
        )}
      >
        {(aria) => (
          <PasswordInput
            name="currentPassword"
            autoComplete="current-password"
            placeholder={t("changePasswordCurrentPlaceholder")}
            {...aria}
          />
        )}
      </AuthField>
      <AuthField
        key={`new-${flow.completions}`}
        errorId={`${ID_PREFIX}-new-password-error`}
        error={texts.fieldError("newPassword", flow.fieldErrors.newPassword)}
      >
        {(aria) => (
          <PasswordInput
            name="newPassword"
            autoComplete="new-password"
            placeholder={t("changePasswordNewPlaceholder")}
            {...aria}
          />
        )}
      </AuthField>
      <BusyButton type="submit" busy={flow.submitting}>
        {t("changePasswordSubmit")}
      </BusyButton>
    </form>
  );
}
