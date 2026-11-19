import { useEffect, useState } from "react";
import type { CooldownTick } from "../application/email-otp";
import { RESEND_COOLDOWN_SECONDS } from "../domain/auth-code";

// 再送待機の残り秒数がある間、1秒ごとに進める(UIの副作用)。
export function useResendCooldownTick(
  resendCooldown: number,
  tick: CooldownTick,
  dispatch: Parameters<CooldownTick>[0],
) {
  useEffect(
    () => (resendCooldown === 0 ? undefined : tick(dispatch)),
    [resendCooldown, tick, dispatch],
  );
}

// コード入力の値。コードを再送したときに消す。コード入力の段階を離れると、部品とともに破棄される。
export function useCodeInput(resendCooldown: number) {
  const [code, setCode] = useState("");
  useEffect(() => {
    if (resendCooldown === RESEND_COOLDOWN_SECONDS) setCode("");
  }, [resendCooldown]);
  return [code, setCode] as const;
}
