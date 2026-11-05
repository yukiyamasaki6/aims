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
  const signInLink = { label: t("resetBackToSignIn") };
  const copy = {
    idPrefix: "reset-password",
    emailTitle: t("resetTitle"),
    emailFooter: signInLink,
    passwordTitle: t("resetPasswordTitle"),
    passwordDescription: t("resetPasswordDescription"),
    passwordLabel: t("resetPasswordLabel"),
    passwordSubmit: t("resetPasswordSubmit"),
    passwordFooter: signInLink,
  };
  return (
    <PasswordSetupForm
      procedure={resetPassword}
      copy={copy}
      siteKey={siteKey}
    />
  );
}
