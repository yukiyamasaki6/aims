"use client";

import { type Dispatch, type FormEvent, type RefObject, useRef } from "react";
import {
  CAPTCHA_INCOMPLETE_MESSAGE,
  isCaptchaCompleted,
} from "@/features/auth";
import { createClient } from "@/lib/supabase/client";
import type { SubmitGuard } from "../_shared/use-submit-guard";
import {
  validateCodeField,
  validateEmailField,
  validatePasswordField,
  validateResendReady,
} from "../_shared/validate";
import type { ResetPasswordAction } from "./reset-password-flow";

type ResetPasswordContext = {
  email: string;
  code: string;
  password: string;
  resendCooldown: number;
  captchaToken: string | null;
  dispatch: Dispatch<ResetPasswordAction>;
  mountedRef: RefObject<boolean>;
  // 送信・変更の二重送信防止。
  primary: SubmitGuard;
  // コード入力画面の確認・再送・戻るは排他にする。
  // 確認・再送の応答待ちに他の操作を許すと、後から届いた応答が別の画面（メールアドレス入力やパスワード設定）へ反映されてしまうため。
  codeStepBusyRef: RefObject<boolean>;
  consumeCaptchaToken: () => void;
  setCaptchaToken: (token: string | null) => void;
  setCode: (code: string) => void;
};

function back(ctx: ResetPasswordContext) {
  if (ctx.codeStepBusyRef.current) return;
  ctx.dispatch({ type: "reset_to_email" });
  ctx.setCode("");
  ctx.setCaptchaToken(null);
}

async function resend(ctx: ResetPasswordContext) {
  const { dispatch, mountedRef, codeStepBusyRef, email, captchaToken } = ctx;
  if (codeStepBusyRef.current) return;

  const errors = validateResendReady(ctx.resendCooldown, captchaToken);
  if (errors.resend || !captchaToken) {
    dispatch({ type: "resend_invalid", errors });
    return;
  }

  codeStepBusyRef.current = true;
  dispatch({ type: "resend_started" });

  try {
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      captchaToken,
    });

    // mountedRefの確認より前にturnstileRefへ触れない。
    // 送信中に別リンクへ移動してアンマウントされていた場合、破棄済みのウィジェットへのreset()呼び出しを避ける。
    if (!mountedRef.current) return;

    ctx.consumeCaptchaToken();

    if (error) {
      dispatch({ type: "resend_auth_error", error });
    } else {
      dispatch({ type: "resend_succeeded" });
    }
    codeStepBusyRef.current = false;
  } catch {
    if (!mountedRef.current) return;
    dispatch({ type: "resend_network_error" });
    codeStepBusyRef.current = false;
  }
}

async function sendCode(ctx: ResetPasswordContext) {
  if (ctx.primary.isLocked()) return;

  const errors = validateEmailField(ctx.email);
  if (errors.email) {
    ctx.dispatch({ type: "send_code_invalid", errors });
    return;
  }
  if (!isCaptchaCompleted(ctx.captchaToken)) {
    ctx.dispatch({
      type: "send_code_invalid",
      errors: { captcha: CAPTCHA_INCOMPLETE_MESSAGE },
    });
    return;
  }

  return submitSendCode(ctx, ctx.captchaToken);
}

async function submitSendCode(ctx: ResetPasswordContext, captchaToken: string) {
  const { dispatch, mountedRef, primary, email } = ctx;
  dispatch({ type: "send_code_started" });
  primary.lock();
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      captchaToken,
    });

    if (!mountedRef.current) return;

    ctx.consumeCaptchaToken();

    if (error) {
      dispatch({ type: "send_code_auth_error", error });
    } else {
      dispatch({ type: "send_code_succeeded" });
    }
    primary.unlock();
  } catch {
    if (!mountedRef.current) return;
    dispatch({ type: "send_code_network_error" });
    primary.unlock();
  }
}

async function verifyCode(ctx: ResetPasswordContext) {
  const { dispatch, mountedRef, codeStepBusyRef } = ctx;
  if (codeStepBusyRef.current) return;

  const errors = validateCodeField(ctx.code);
  if (errors.code) {
    dispatch({ type: "verify_code_invalid", errors });
    return;
  }

  codeStepBusyRef.current = true;
  dispatch({ type: "verify_code_started" });
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email: ctx.email,
      token: ctx.code,
      type: "recovery",
    });

    if (!mountedRef.current) return;

    if (error) {
      dispatch({ type: "verify_code_auth_error", error });
    } else {
      dispatch({ type: "verify_code_succeeded" });
    }
    codeStepBusyRef.current = false;
  } catch {
    if (!mountedRef.current) return;
    dispatch({ type: "verify_code_network_error" });
    codeStepBusyRef.current = false;
  }
}

async function setPassword(ctx: ResetPasswordContext) {
  const { dispatch, mountedRef, primary, password } = ctx;
  if (primary.isLocked()) return;

  const errors = validatePasswordField(password);
  if (errors.password) {
    dispatch({ type: "set_password_invalid", errors });
    return;
  }

  dispatch({ type: "set_password_started" });
  primary.lock();
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (!mountedRef.current) return;

    if (error) {
      dispatch({ type: "set_password_auth_error", error });
      primary.unlock();
      return;
    }

    await supabase.auth.signOut();
    window.location.assign("/signin");
  } catch {
    if (!mountedRef.current) return;
    dispatch({ type: "set_password_network_error" });
    primary.unlock();
  }
}

// パスワード再設定の各画面の操作。入力値と画面の状態はフォームが持ち、ここでは送信と応答の処理を行う。
export function useResetPasswordHandlers(
  deps: Omit<ResetPasswordContext, "codeStepBusyRef">,
) {
  const codeStepBusyRef = useRef(false);
  const ctx: ResetPasswordContext = {
    ...deps,
    codeStepBusyRef,
  };

  return {
    handleBack: () => back(ctx),
    handleResend: () => resend(ctx),
    handleSendCode: (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      return sendCode(ctx);
    },
    handleVerifyCode: (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      return verifyCode(ctx);
    },
    handleSetPassword: (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      return setPassword(ctx);
    },
  };
}
