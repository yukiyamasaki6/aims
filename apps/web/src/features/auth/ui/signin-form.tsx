"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { AuthHeader } from "@/components/auth-header";
import { Turnstile } from "@/components/turnstile";
import { BusyButton } from "@/components/ui/busy-button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useHydrated } from "@/hooks/use-hydrated";
import type { SignIn } from "../application/sign-in";
import { EMAIL_MAX_LENGTH } from "../domain/email-address";
import { RESET_PASSWORD_PATH, SIGN_UP_PATH } from "../domain/routes";
import {
  initialSignInFlow,
  type SignInFlow,
  signInReducer,
} from "../domain/sign-in-flow";
import { AuthField } from "./auth-field";
import { useScreenView } from "./use-screen-view";

// エラー文の要素のidの接頭辞(`${ID_PREFIX}-email-error`)。
const ID_PREFIX = "signin";

export function SignInForm({ signIn }: { signIn: SignIn }) {
  const {
    state: flow,
    view,
    checkRef,
  } = useScreenView(signInReducer, initialSignInFlow);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const hydrated = useHydrated();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void signIn.submit({ email, password }, view);
  }

  return (
    <>
      <AuthHeader title="サインイン" />
      <form
        onSubmit={onSubmit}
        noValidate
        data-hydrated={hydrated}
        className="flex w-full flex-col gap-3"
      >
        <SignInFields
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          fieldErrors={flow.fieldErrors}
        />
        <Turnstile
          ref={checkRef}
          onVerify={(token) => view.dispatch({ type: "captchaChecked", token })}
          error={flow.fieldErrors.captcha}
        />
        <BusyButton
          type="submit"
          data-captcha-ready={flow.captchaToken !== null}
          busy={flow.submitting}
        >
          サインイン
        </BusyButton>
      </form>
      {flow.error && (
        <p className="text-center text-destructive text-sm">{flow.error}</p>
      )}
      <p className="text-muted-foreground text-sm">
        <Link href={RESET_PASSWORD_PATH} className="underline">
          パスワードをお忘れですか
        </Link>
      </p>
      <p className="text-muted-foreground text-sm">
        アカウントをお持ちでない方は{" "}
        <Link href={SIGN_UP_PATH} className="underline">
          サインアップ
        </Link>
      </p>
    </>
  );
}

function SignInFields({
  email,
  setEmail,
  password,
  setPassword,
  fieldErrors,
}: {
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  fieldErrors: SignInFlow["fieldErrors"];
}) {
  return (
    <>
      <AuthField errorId={`${ID_PREFIX}-email-error`} error={fieldErrors.email}>
        {(aria) => (
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={EMAIL_MAX_LENGTH}
            {...aria}
          />
        )}
      </AuthField>
      <AuthField
        errorId={`${ID_PREFIX}-password-error`}
        error={fieldErrors.password}
      >
        {(aria) => (
          <PasswordInput
            placeholder="パスワード"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...aria}
          />
        )}
      </AuthField>
    </>
  );
}
