"use client";

import { useState } from "react";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createStart } from "@/features/navigation/application/start";
import { createAuthSignInCheck } from "@/features/navigation/infrastructure/auth-sign-in-check";
import { IntroScreen } from "@/features/navigation/ui/intro-screen";
import { createClient } from "@/lib/supabase/infrastructure/client";

export default function Home() {
  // 画面を開いている間、同じ手続きを保つ。
  const [start] = useState(() =>
    createStart({
      signInCheck: createAuthSignInCheck(createSupabaseAuth(createClient)),
    }),
  );

  return <IntroScreen start={start} />;
}
