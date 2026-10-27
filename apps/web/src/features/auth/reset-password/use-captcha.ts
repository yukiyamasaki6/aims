"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef, useState } from "react";

// Turnstileのトークンと、ウィジェットへの参照。使用済みのトークンは消費して取り直す。
export function useCaptcha() {
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(undefined);

  function consumeCaptchaToken() {
    turnstileRef.current?.reset();
    setCaptchaToken(null);
  }

  return { captchaToken, setCaptchaToken, turnstileRef, consumeCaptchaToken };
}
