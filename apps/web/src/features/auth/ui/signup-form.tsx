"use client";

import { useTranslations } from "next-intl";
import type { SignUp } from "../application/sign-up";
import { EmailOtpForm } from "./email-otp-form";

export function SignUpForm({
  signUp,
  siteKey,
}: {
  signUp: SignUp;
  siteKey: string;
}) {
  const t = useTranslations("auth");
  return (
    <EmailOtpForm
      procedure={signUp}
      siteKey={siteKey}
      copy={{ idPrefix: "signup", emailTitle: t("signUpTitle") }}
    />
  );
}
