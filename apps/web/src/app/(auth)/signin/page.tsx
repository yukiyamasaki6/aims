"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createSignIn } from "@/features/auth/application/sign-in";
import { RETURN_TO_PARAM } from "@/features/auth/domain/auth-routes";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SignInForm } from "@/features/auth/ui/signin-form";
import { ROUNDS_PATH } from "@/features/rounds/domain/round-routes";
import { createRouterPageNavigation } from "@/lib/page-navigation/infrastructure/router-page-navigation";
import { createClient } from "@/lib/supabase/infrastructure/client";

// useSearchParamsを使う部品はSuspenseで包む(事前描画を保つため)。
export default function SignInPage() {
  return (
    <Suspense>
      <SignInScreen />
    </Suspense>
  );
}

function SignInScreen() {
  const router = useRouter();
  // URLのクエリの遷移元。検証せずに画面の部品へ渡し、検証は手続きが経路の規則で行う。
  const from = useSearchParams().get(RETURN_TO_PARAM);
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
      from={from}
    />
  );
}
