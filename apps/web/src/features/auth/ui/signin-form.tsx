"use client";

import type { GoogleSignIn } from "../application/google-sign-in";
import type { SignIn } from "../application/sign-in";
import { signInHref } from "../domain/auth-routes";
import { EmailOtpForm } from "./email-otp-form";
import { GoogleSignInSection } from "./google-sign-in-section";

export function SignInForm({
  signIn,
  googleSignIn,
  siteKey,
  readReturnTo,
}: {
  signIn: SignIn;
  googleSignIn: GoogleSignIn;
  siteKey: string;
  readReturnTo: () => string | null;
}) {
  return (
    <EmailOtpForm
      procedure={signIn}
      siteKey={siteKey}
      readReturnTo={readReturnTo}
      idPrefix="signin"
      emailStepLeading={
        <GoogleSignInSection
          googleSignIn={googleSignIn}
          // 戻り先は、押した時点の遷移元を載せた/signin。戻った画面が、同じ遷移元へ進む。
          readReturn={() => {
            const from = readReturnTo();
            return { returnPath: signInHref(from), destination: from };
          }}
        />
      }
    />
  );
}
