"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSignUp } from "@/features/auth/application/sign-up";
import { createBrowserNavigation } from "@/features/auth/infrastructure/browser-navigation";
import { createSupabaseSignUpAuthenticator } from "@/features/auth/infrastructure/supabase-sign-up-authenticator";
import { SignUpForm } from "@/features/auth/ui/signup-form";
import { createClient } from "@/lib/supabase/client";
import { isEmailRegistered } from "./actions";

export default function SignUpPage() {
  const router = useRouter();
  // 画面を開いている間、同じ手続きを保つ。接続は、認証の実装が操作のたびに取得する(描画時には作らない)。
  const [signUp] = useState(() =>
    createSignUp({
      authenticator: createSupabaseSignUpAuthenticator({
        getClient: createClient,
        isEmailRegistered,
      }),
      navigation: createBrowserNavigation(router),
    }),
  );
  return <SignUpForm signUp={signUp} />;
}
