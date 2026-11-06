"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createResetPassword } from "@/features/auth/application/reset-password";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { ResetPasswordForm } from "@/features/auth/ui/reset-password-form";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createRouterPageNavigation } from "@/lib/page-navigation/infrastructure/router-page-navigation";
import { createClient } from "@/lib/supabase/infrastructure/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  // 画面を開いている間、同じ手続きを保つ。
  const [resetPassword] = useState(() =>
    createResetPassword({
      authenticator: createSupabaseAuth(createClient),
      pageNavigation: createRouterPageNavigation(router),
      clock: createBrowserClock(),
    }),
  );
  return (
    <ResetPasswordForm
      resetPassword={resetPassword}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
    />
  );
}
