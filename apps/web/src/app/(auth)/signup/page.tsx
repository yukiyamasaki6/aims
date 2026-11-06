"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSignUp } from "@/features/auth/application/sign-up";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SignUpForm } from "@/features/auth/ui/signup-form";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createRouterPageNavigation } from "@/lib/page-navigation/infrastructure/router-page-navigation";
import { createClient } from "@/lib/supabase/infrastructure/client";

export default function SignUpPage() {
  const router = useRouter();
  // 画面を開いている間、同じ手続きを保つ。
  const [signUp] = useState(() =>
    createSignUp({
      authenticator: createSupabaseAuth(createClient),
      pageNavigation: createRouterPageNavigation(router),
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
