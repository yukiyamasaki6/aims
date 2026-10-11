"use client";

import { useReducer, useState } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import { useCaptcha } from "../_shared/use-captcha";
import { useResendCountdown } from "../_shared/use-resend-countdown";
import { useSubmitGuard } from "../_shared/use-submit-guard";
import {
  initialResetPasswordState,
  resetPasswordReducer,
} from "./reset-password-flow";
import { useResetPasswordHandlers } from "./use-reset-password-handlers";

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

  useResendCountdown(state.resendCooldown, dispatch);

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
