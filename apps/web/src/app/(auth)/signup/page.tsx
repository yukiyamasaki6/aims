"use client";

import { useState } from "react";
import { createSignUp } from "@/features/auth/application/sign-up";
import { createBrowserPageLoad } from "@/features/auth/infrastructure/browser-page-load";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SignUpForm } from "@/features/auth/ui/signup-form";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createClient } from "@/lib/supabase/infrastructure/client";

export default function SignUpPage() {
  // 画面を開いている間、同じ手続きを保つ。
  const [signUp] = useState(() =>
    createSignUp({
      authenticator: createSupabaseAuth(createClient),
      pageReplace: createBrowserPageLoad(),
      clock: createBrowserClock(),
      connectivity: createBrowserConnectivity(),
    }),
  );
  return (
    <SignUpForm
      signUp={signUp}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
    />
  );
}
