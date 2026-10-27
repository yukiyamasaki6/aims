"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSignIn } from "@/features/auth/application/sign-in";
import { createBrowserNavigation } from "@/features/auth/infrastructure/browser-navigation";
import { createSupabaseAuthenticator } from "@/features/auth/infrastructure/supabase-authenticator";
import { SignInForm } from "@/features/auth/ui/signin-form";
import { createClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const router = useRouter();
  // 画面を開いている間、同じ手続きを保つ。接続は、認証の実装が照合のたびに取得する(描画時には作らない)。ブラウザでは呼ぶたびに同じものが返る。
  const [signIn] = useState(() =>
    createSignIn({
      authenticator: createSupabaseAuthenticator(createClient),
      navigation: createBrowserNavigation(router),
    }),
  );
  return <SignInForm signIn={signIn} />;
}
