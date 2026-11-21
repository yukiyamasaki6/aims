"use client";

import { useState } from "react";
import { createGoogleSignIn } from "@/features/auth/application/google-sign-in";
import { createSignIn } from "@/features/auth/application/sign-in";
import {
  RETURN_TO_PARAM,
  returnToWithHash,
} from "@/features/auth/domain/auth-routes";
import { createBrowserPageAddress } from "@/features/auth/infrastructure/browser-page-address";
import { createBrowserPageLoad } from "@/features/auth/infrastructure/browser-page-load";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SignInForm } from "@/features/auth/ui/signin-form";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createClient } from "@/lib/supabase/infrastructure/client";

// 送信時のURLのクエリの遷移元の値(検証しない。検証は手続きが経路の規則で行う)。事前描画を静的に保つため、描画時には読まない。
// 遷移元がハッシュを持たないときは、今のURLのハッシュ(proxy.tsのリダイレクトでブラウザが引き継いだもの)を足す。
const readReturnTo = () =>
  returnToWithHash(
    new URLSearchParams(window.location.search).get(RETURN_TO_PARAM),
    window.location.hash,
  );

export default function SignInPage() {
  // 画面を開いている間、同じ手続きを保つ。
  const [procedures] = useState(() => {
    const authenticator = createSupabaseAuth(createClient);
    const pageReplace = createBrowserPageLoad();
    const connectivity = createBrowserConnectivity();
    return {
      signIn: createSignIn({
        authenticator,
        pageReplace,
        clock: createBrowserClock(),
        connectivity,
      }),
      googleSignIn: createGoogleSignIn({
        authenticator,
        address: createBrowserPageAddress(),
        pageReplace,
        connectivity,
      }),
    };
  });
  return (
    <SignInForm
      signIn={procedures.signIn}
      googleSignIn={procedures.googleSignIn}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
      readReturnTo={readReturnTo}
    />
  );
}
