"use client";

import {
  Turnstile as ReactTurnstile,
  type TurnstileInstance,
} from "@marsidev/react-turnstile";
import { forwardRef, useState } from "react";
import { cn } from "@/lib/utils";

export const Turnstile = forwardRef<
  TurnstileInstance | undefined,
  { onVerify: (token: string | null) => void; error?: string }
>(function Turnstile({ onVerify, error }, ref) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  // 利用者の操作が必要なチャレンジが出ている間だけtrueにする。
  const [interactive, setInteractive] = useState(false);

  if (!siteKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_TURNSTILE_SITE_KEY environment variable.",
    );
  }

  return (
    <>
      {/*
        appearance: "interaction-only"で、操作が必要なときだけウィジェットが現れる。
        通常は画面の領域を取らないようsr-only（1pxのabsolute）に畳む。
        チャレンジの実行に影響し得るため、hiddenやdisplay:noneにはしない。
        操作が必要なときは、Cloudflareの公式仕様（normalサイズ = 300x65px）の領域で表示する。
      */}
      <div
        className={cn(
          interactive ? "h-[65px] w-[300px] self-center rounded-lg" : "sr-only",
          interactive && error && "ring-3 ring-destructive/50",
        )}
      >
        <ReactTurnstile
          ref={ref}
          siteKey={siteKey}
          onBeforeInteractive={() => setInteractive(true)}
          onAfterInteractive={() => setInteractive(false)}
          onSuccess={(token) => {
            setInteractive(false);
            onVerify(token);
          }}
          onExpire={() => {
            setInteractive(false);
            onVerify(null);
          }}
          onError={() => {
            setInteractive(true);
            onVerify(null);
          }}
          options={{ size: "normal", appearance: "interaction-only" }}
        />
      </div>
      {error && <p className="text-center text-destructive text-sm">{error}</p>}
    </>
  );
});
