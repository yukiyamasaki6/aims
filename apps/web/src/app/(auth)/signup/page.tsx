"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSignUp } from "@/features/auth/application/sign-up";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SignUpForm } from "@/features/auth/ui/signup-form";
import { ROUNDS_PATH } from "@/features/rounds/domain/round-routes";
import { createRouterPageNavigation } from "@/lib/page-navigation/infrastructure/router-page-navigation";
import { createClient } from "@/lib/supabase/infrastructure/client";
import { isEmailRegistered } from "./actions";

export default function SignUpPage() {
  const router = useRouter();
  // 画面を開いている間、同じ手続きを保つ。
  const [signUp] = useState(() =>
    createSignUp({
      authenticator: createSupabaseAuth(createClient),
      registration: { isRegistered: isEmailRegistered },
      pageNavigation: createRouterPageNavigation(router),
      protectedPath: ROUNDS_PATH,
    }),
  );
  return <SignUpForm signUp={signUp} />;
}
