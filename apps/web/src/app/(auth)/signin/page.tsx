"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSignIn } from "@/features/auth/application/sign-in";
import { createBrowserReturnTo } from "@/features/auth/infrastructure/browser-return-to";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SignInForm } from "@/features/auth/ui/signin-form";
import { ROUNDS_PATH } from "@/features/rounds/domain/round-routes";
import { createRouterPageNavigation } from "@/lib/page-navigation/infrastructure/router-page-navigation";
import { createClient } from "@/lib/supabase/infrastructure/client";

export default function SignInPage() {
  const router = useRouter();
  // 画面を開いている間、同じ手続きを保つ。
  const [signIn] = useState(() =>
    createSignIn({
      authenticator: createSupabaseAuth(createClient),
      pageNavigation: createRouterPageNavigation(router),
      returnToReader: createBrowserReturnTo(),
      protectedPath: ROUNDS_PATH,
    }),
  );
  return (
    <SignInForm
      signIn={signIn}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
    />
  );
}
