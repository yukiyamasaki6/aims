"use client";

import { useTranslations } from "next-intl";
import type { PasswordSetup } from "../application/password-setup";
import { PasswordSetupForm } from "./password-setup-form";

export function ResetPasswordForm({
  resetPassword,
  siteKey,
}: {
  resetPassword: PasswordSetup;
  siteKey: string;
}) {
  const t = useTranslations("auth");
  const copy = {
    idPrefix: "reset-password",
    emailTitle: t("resetTitle"),
    emailFooter: { label: t("resetBackToSignIn") },
    passwordTitle: t("resetPasswordTitle"),
    passwordDescription: t("resetPasswordDescription"),
    passwordLabel: t("resetPasswordLabel"),
    passwordSubmit: t("resetPasswordSubmit"),
  };
  return (
    <PasswordSetupForm
      procedure={resetPassword}
      copy={copy}
      siteKey={siteKey}
    />
  );
}
