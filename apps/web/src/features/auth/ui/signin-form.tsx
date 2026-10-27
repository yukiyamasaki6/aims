"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { type ComponentRef, type FormEvent, useRef, useState } from "react";
import { AuthHeader } from "@/components/auth-header";
import { Turnstile } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import { cn } from "@/lib/utils";
import type { SignIn } from "../application/sign-in";
import { EMAIL_MAX_LENGTH } from "../domain/email-address";
import {
  type FieldErrors,
  initialAttempt,
  signInReducer,
} from "../domain/sign-in-attempt";
import { useScreenView } from "./use-screen-view";

export function SignInForm({ signIn }: { signIn: SignIn }) {
  const mounted = useMountedRef();
  const check = useRef<ComponentRef<typeof Turnstile>>(undefined);
  const { state: attempt, view } = useScreenView(
    signInReducer,
    initialAttempt,
    {
      isMounted: () => mounted.current,
      resetCheck: () => check.current?.reset(),
    },
  );
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
          fieldErrors={attempt.fieldErrors}
        />
        <Turnstile
          ref={check}
          onVerify={(token) => view.dispatch({ type: "verified", token })}
          error={attempt.fieldErrors.captcha}
        />
        <Button
          type="submit"
          data-captcha-ready={attempt.captchaToken !== null}
          aria-disabled={attempt.submitting}
          className={cn(attempt.submitting && "pointer-events-none opacity-50")}
        >
          {attempt.submitting && <Loader2 className="size-3.5 animate-spin" />}
          サインイン
        </Button>
      </form>
      {attempt.error && (
        <p className="text-center text-destructive text-sm">{attempt.error}</p>
      )}
      <p className="text-muted-foreground text-sm">
        <Link href="/reset-password" className="underline">
          パスワードをお忘れですか
        </Link>
      </p>
      <p className="text-muted-foreground text-sm">
        アカウントをお持ちでない方は{" "}
        <Link href="/signup" className="underline">
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
  fieldErrors: FieldErrors;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <Input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={EMAIL_MAX_LENGTH}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={
            fieldErrors.email ? "signin-email-error" : undefined
          }
        />
        {fieldErrors.email && (
          <p id="signin-email-error" className="text-destructive text-sm">
            {fieldErrors.email}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <PasswordInput
          placeholder="パスワード"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={
            fieldErrors.password ? "signin-password-error" : undefined
          }
        />
        {fieldErrors.password && (
          <p id="signin-password-error" className="text-destructive text-sm">
            {fieldErrors.password}
          </p>
        )}
      </div>
    </>
  );
}
