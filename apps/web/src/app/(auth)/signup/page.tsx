"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSignUp } from "@/features/auth/application/sign-up";
import { createBrowserNavigation } from "@/features/auth/infrastructure/browser-navigation";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SignUpForm } from "@/features/auth/ui/signup-form";
import { createClient } from "@/lib/supabase/infrastructure/client";
import { isEmailRegistered } from "./actions";

export default function SignUpPage() {
  const router = useRouter();
  // 画面を開いている間、同じ手続きを保つ。
  const [signUp] = useState(() =>
    createSignUp({
      authenticator: createSupabaseAuth(createClient),
      registration: { isRegistered: isEmailRegistered },
      navigation: createBrowserNavigation(router),
    }),
  );
  return <SignUpForm signUp={signUp} />;
}
