"use client";

import { useTranslations } from "next-intl";
import type { PasswordSetup } from "../application/password-setup";
import { PasswordSetupForm } from "./password-setup-form";

export function SignUpForm({
  signUp,
  siteKey,
}: {
  signUp: PasswordSetup;
  siteKey: string;
}) {
  const t = useTranslations("auth");
  const copy = {
    idPrefix: "signup",
    emailTitle: t("signUpTitle"),
    emailFooter: { lead: t("signUpFooterLead"), label: t("signUpFooterLink") },
    passwordTitle: t("signUpPasswordTitle"),
    passwordLabel: t("signUpPasswordLabel"),
    passwordSubmit: t("signUpPasswordSubmit"),
  };
  return <PasswordSetupForm procedure={signUp} copy={copy} siteKey={siteKey} />;
}
