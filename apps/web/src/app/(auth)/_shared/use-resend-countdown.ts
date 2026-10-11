"use client";

import { type Dispatch, useEffect } from "react";

// 再送できるまでの秒数を、0になるまで1秒ごとに進める。
export function useResendCountdown(
  resendCooldown: number,
  dispatch: Dispatch<{ type: "resend_tick" }>,
) {
  useEffect(() => {
    if (resendCooldown === 0) return;
    const timer = setTimeout(() => dispatch({ type: "resend_tick" }), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown, dispatch]);
}
