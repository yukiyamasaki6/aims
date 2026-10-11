"use client";

import { useReducer, useState } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import { useCaptcha } from "../_shared/use-captcha";
import { useResendCountdown } from "../_shared/use-resend-countdown";
import { useSubmitGuard } from "../_shared/use-submit-guard";
import { initialSignUpState, signupReducer } from "./signup-flow";
import { useSignUpHandlers } from "./use-signup-handlers";

// フォーム全体の入力値、画面の状態、操作。画面の段階ごとのコンポーネントが必要な項目を取り出して使う。
export function useSignUpForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [state, dispatch] = useReducer(signupReducer, initialSignUpState);
  const { captchaToken, setCaptchaToken, turnstileRef, consumeCaptchaToken } =
    useCaptcha();
  const mountedRef = useMountedRef();
  const primary = useSubmitGuard();
  const hydrated = useHydrated();

  useResendCountdown(state.resendCooldown, dispatch);

  const handlers = useSignUpHandlers({
    email,
    code,
    password,
    resendCooldown: state.resendCooldown,
    captchaToken,
    dispatch,
    mountedRef,
    primary,
    consumeCaptchaToken,
    setCaptchaToken,
    setCode,
  });

  return {
    ...state,
    ...handlers,
    email,
    setEmail,
    code,
    setCode,
    password,
    setPassword,
    captchaToken,
    setCaptchaToken,
    turnstileRef,
    primarySubmitting: primary.submitting,
    hydrated,
  };
}

export type SignUpFormModel = ReturnType<typeof useSignUpForm>;
