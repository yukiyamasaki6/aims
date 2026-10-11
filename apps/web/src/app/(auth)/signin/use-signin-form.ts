"use client";

import { useRouter } from "next/navigation";
import {
  type Dispatch,
  type FormEvent,
  type RefObject,
  useReducer,
  useState,
} from "react";
import { readReturnTo } from "@/features/auth/return-to";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import { createClient } from "@/lib/supabase/client";
import { useCaptcha } from "../_shared/use-captcha";
import { type SubmitGuard, useSubmitGuard } from "../_shared/use-submit-guard";
import {
  initialSignInState,
  type SignInAction,
  signinReducer,
} from "./signin-flow";
import { validateSignInFields } from "./validate";

type SignInContext = {
  email: string;
  password: string;
  captchaToken: string | null;
  dispatch: Dispatch<SignInAction>;
  mountedRef: RefObject<boolean>;
  submitting: SubmitGuard;
  consumeCaptchaToken: () => void;
  goToDestination: () => void;
};

async function handleSubmit(ctx: SignInContext) {
  if (ctx.submitting.isLocked()) return;

  const errors = validateSignInFields(ctx.email, ctx.password);
  if (errors.email || errors.password) {
    ctx.dispatch({ type: "submit_invalid", errors });
    return;
  }
  if (!ctx.captchaToken) {
    ctx.dispatch({
      type: "submit_invalid",
      errors: { captcha: "セキュリティチェックが完了していません。" },
    });
    return;
  }

  return submit(ctx, ctx.captchaToken);
}

async function submit(ctx: SignInContext, captchaToken: string) {
  const { dispatch, mountedRef, submitting, email, password } = ctx;
  dispatch({ type: "submit_started" });
  submitting.lock();
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    });

    // mountedRefの確認より前にturnstileRefへ触れない。
    // 送信中に別リンクへ移動してアンマウントされていた場合、破棄済みのウィジェットへのreset()呼び出しを避ける。
    if (!mountedRef.current) return;

    if (error) {
      dispatch({ type: "submit_auth_error", error });
      ctx.consumeCaptchaToken();
      submitting.unlock();
      return;
    }

    // 成功時はここでsubmittingを解除しない。
    // router.push()は遷移先の取得中もこのコンポーネントを保持し続けるため、ここで解除すると遷移完了前にボタンが再度押せる状態に戻り、同じ（使用済みの）captchaトークンで二重に送信されてしまう。
    // アンマウント時に自然に破棄される。
    ctx.goToDestination();
  } catch {
    if (!mountedRef.current) return;
    dispatch({ type: "submit_network_error" });
    ctx.consumeCaptchaToken();
    submitting.unlock();
  }
}

// サインインフォームの入力値、画面の状態、送信。
export function useSignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [{ error, fieldErrors }, dispatch] = useReducer(
    signinReducer,
    initialSignInState,
  );
  const { captchaToken, setCaptchaToken, turnstileRef, consumeCaptchaToken } =
    useCaptcha();
  const mountedRef = useMountedRef();
  const submitting = useSubmitGuard();
  const hydrated = useHydrated();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    return handleSubmit({
      email,
      password,
      captchaToken,
      dispatch,
      mountedRef,
      submitting,
      consumeCaptchaToken,
      goToDestination: () =>
        router.push(readReturnTo(window.location.search) ?? "/rounds"),
    });
  }

  return {
    email,
    setEmail,
    password,
    setPassword,
    error,
    fieldErrors,
    captchaToken,
    setCaptchaToken,
    turnstileRef,
    submitting: submitting.submitting,
    hydrated,
    onSubmit,
  };
}

export type SignInFormModel = ReturnType<typeof useSignInForm>;
