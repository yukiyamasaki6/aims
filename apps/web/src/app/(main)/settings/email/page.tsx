"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createChangeEmail } from "@/features/auth/application/change-email";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { ChangeEmailForm } from "@/features/auth/ui/change-email-form";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createRouterPageNavigation } from "@/lib/page-navigation/infrastructure/router-page-navigation";
import { createClient } from "@/lib/supabase/infrastructure/client";

export default function ChangeEmailPage() {
  const router = useRouter();
  // 画面を開いている間、同じ手続きを保つ。
  const [changeEmail] = useState(() =>
    createChangeEmail({
      authenticator: createSupabaseAuth(createClient),
      connectivity: createBrowserConnectivity(),
      clock: createBrowserClock(),
      pageNavigation: createRouterPageNavigation(router),
    }),
  );
  return (
    <ChangeEmailForm
      changeEmail={changeEmail}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
    />
  );
}
