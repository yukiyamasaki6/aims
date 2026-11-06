"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { Input } from "@/components/ui/input";
import { useHydrated } from "@/hooks/use-hydrated";
import { RESET_PASSWORD_PATH, SIGN_UP_PATH } from "@/routes";
import type { SignIn } from "../application/sign-in";
import {
  initialSignInFlow,
  type SignInFlow,
  signInReducer,
} from "../domain/sign-in-flow";
import { AuthField } from "./auth-field";
import { AuthHeader } from "./auth-header";
import { PasswordInput } from "./password-input";
import { Turnstile } from "./turnstile";
import { useAuthTexts } from "./use-auth-texts";
import { useScreenView } from "./use-screen-view";

// エラー文の要素のidの接頭辞(`${ID_PREFIX}-email-error`)。
const ID_PREFIX = "signin";

export function SignInForm({
  signIn,
  siteKey,
  readReturnTo,
}: {
  signIn: SignIn;
  siteKey: string;
  // 送信時に呼ぶ、URLのクエリの遷移元の値の読み出し(検証していない値で、無ければnull)。
  readReturnTo: () => string | null;
}) {
  const {
    state: flow,
    view,
    checkRef,
  } = useScreenView(signInReducer, initialSignInFlow);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const hydrated = useHydrated();
  const t = useTranslations("auth");
  const texts = useAuthTexts();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void signIn.submit({ email, password, from: readReturnTo() }, view);
  }

  return (
    <>
      <AuthHeader title={t("signInTitle")} />
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
          siteKey={siteKey}
          ref={checkRef}
          onVerify={(token) => view.dispatch({ type: "captchaChecked", token })}
          error={texts.fieldError("captcha", flow.fieldErrors.captcha)}
        />
        <BusyButton type="submit" busy={flow.submitting}>
          {t("signInSubmit")}
        </BusyButton>
      </form>
      {flow.error && (
        <p className="text-center text-destructive text-sm">
          {texts.failure(flow.error)}
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        <Link href={RESET_PASSWORD_PATH} className="underline">
          {t("signInForgotPassword")}
        </Link>
      </p>
      <p className="text-muted-foreground text-sm">
        {t("signInNoAccount")}{" "}
        <Link href={SIGN_UP_PATH} className="underline">
          {t("signInSignUpLink")}
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
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  const passwordRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <AuthField
        errorId={`${ID_PREFIX}-email-error`}
        error={texts.fieldError("email", fieldErrors.email)}
      >
        {(aria) => (
          <Input
            type="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            enterKeyHint="next"
            // 変換中でないEnterは、送信せずにパスワード欄へ進む。送信はパスワード欄のEnterとボタンで行う。
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              passwordRef.current?.focus();
            }}
            {...aria}
          />
        )}
      </AuthField>
      <AuthField
        errorId={`${ID_PREFIX}-password-error`}
        error={texts.fieldError("password", fieldErrors.password)}
      >
        {(aria) => (
          <PasswordInput
            ref={passwordRef}
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...aria}
          />
        )}
      </AuthField>
    </>
  );
}
