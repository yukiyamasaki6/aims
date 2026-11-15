"use client";

import { useState } from "react";
import { createChangeEmail } from "@/features/auth/application/change-email";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { ChangeEmailForm } from "@/features/auth/ui/change-email-form";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createClient } from "@/lib/supabase/infrastructure/client";

export default function ChangeEmailPage() {
  // 画面を開いている間、同じ手続きを保つ。
  const [changeEmail] = useState(() =>
    createChangeEmail({
      authenticator: createSupabaseAuth(createClient),
      connectivity: createBrowserConnectivity(),
      clock: createBrowserClock(),
    }),
  );
  return (
    <ChangeEmailForm
      changeEmail={changeEmail}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
    />
  );
}
