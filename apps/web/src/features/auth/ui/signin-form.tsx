"use client";

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
  return (
    <EmailOtpForm
      procedure={signIn}
      siteKey={siteKey}
      readReturnTo={readReturnTo}
      idPrefix="signin"
    />
  );
}
