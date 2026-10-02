"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { redirectToSignIn, watchSessionLoss } from "./session-guard";

// セッションを失ったら/signinへ移す。認証が要る(main)のレイアウトにマウントする。
// 表示は何も行わない。
export function SessionGuard() {
  useEffect(
    () => watchSessionLoss(createClient(), { onLost: redirectToSignIn }),
    [],
  );

  return null;
}
