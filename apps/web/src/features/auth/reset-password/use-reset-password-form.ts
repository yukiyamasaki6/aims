"use client";

import { useReducer, useState } from "react";
import { useCountdown } from "@/hooks/use-countdown";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import {
  initialResetPasswordState,
  resetPasswordReducer,
} from "./reset-password-flow";
import { useCaptcha } from "./use-captcha";
import { useResetPasswordHandlers } from "./use-reset-password-handlers";
import { useSubmitGuard } from "./use-submit-guard";

// フォーム全体の入力値、画面の状態、操作。画面の段階ごとのコンポーネントが必要な項目を取り出して使う。
export function useResetPasswordForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [state, dispatch] = useReducer(
    resetPasswordReducer,
    initialResetPasswordState,
  );
  const { captchaToken, setCaptchaToken, turnstileRef, consumeCaptchaToken } =
    useCaptcha();
  const mountedRef = useMountedRef();
  const primary = useSubmitGuard();
  const hydrated = useHydrated();

  useCountdown(state.resendCooldown, () => dispatch({ type: "resend_tick" }));

  const handlers = useResetPasswordHandlers({
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

export type ResetPasswordFormModel = ReturnType<typeof useResetPasswordForm>;
