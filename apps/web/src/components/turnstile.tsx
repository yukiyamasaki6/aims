"use client";

import {
  Turnstile as ReactTurnstile,
  type TurnstileInstance,
} from "@marsidev/react-turnstile";
import { forwardRef } from "react";

export const Turnstile = forwardRef<
  TurnstileInstance | undefined,
  { onVerify: (token: string | null) => void }
>(function Turnstile({ onVerify }, ref) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  if (!siteKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_TURNSTILE_SITE_KEY environment variable.",
    );
  }

  return (
    <div className="self-center">
      <ReactTurnstile
        ref={ref}
        siteKey={siteKey}
        onSuccess={(token) => onVerify(token)}
        onExpire={() => onVerify(null)}
        onError={() => onVerify(null)}
        options={{ size: "normal" }}
      />
    </div>
  );
});
