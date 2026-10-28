"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSignIn } from "@/features/auth/application/sign-in";
import { createBrowserNavigation } from "@/features/auth/infrastructure/browser-navigation";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SignInForm } from "@/features/auth/ui/signin-form";
import { createClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const router = useRouter();
  // 画面を開いている間、同じ手続きを保つ。
  const [signIn] = useState(() =>
    createSignIn({
      authenticator: createSupabaseAuth(createClient),
      navigation: createBrowserNavigation(router),
    }),
  );
  return <SignInForm signIn={signIn} />;
}
