"use client";

import { useTranslations } from "next-intl";
import type { SignIn } from "../application/sign-in";
import { EmailOtpForm } from "./email-otp-form";

export function SignInForm({
  signIn,
  siteKey,
  readReturnTo,
}: {
  signIn: SignIn;
  siteKey: string;
  readReturnTo: () => string | null;
}) {
  const t = useTranslations("auth");
  return (
    <EmailOtpForm
      procedure={signIn}
      siteKey={siteKey}
      readReturnTo={readReturnTo}
      copy={{ idPrefix: "signin", emailTitle: t("signInTitle") }}
    />
  );
}
