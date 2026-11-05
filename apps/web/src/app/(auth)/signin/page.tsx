"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSignIn } from "@/features/auth/application/sign-in";
import { RETURN_TO_PARAM } from "@/features/auth/domain/auth-routes";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SignInForm } from "@/features/auth/ui/signin-form";
import { ROUNDS_PATH } from "@/features/rounds/domain/round-routes";
import { createRouterPageNavigation } from "@/lib/page-navigation/infrastructure/router-page-navigation";
import { createClient } from "@/lib/supabase/infrastructure/client";

// 送信時のURLのクエリの遷移元の値(検証しない。検証は手続きが経路の規則で行う)。事前描画を静的に保つため、描画時には読まない。
const readReturnTo = () =>
  new URLSearchParams(window.location.search).get(RETURN_TO_PARAM);

export default function SignInPage() {
  const router = useRouter();
  // 画面を開いている間、同じ手続きを保つ。
  const [signIn] = useState(() =>
    createSignIn({
      authenticator: createSupabaseAuth(createClient),
      pageNavigation: createRouterPageNavigation(router),
      protectedPath: ROUNDS_PATH,
    }),
  );
  return (
    <SignInForm
      signIn={signIn}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
      readReturnTo={readReturnTo}
    />
  );
}
