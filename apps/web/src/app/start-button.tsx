"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { SIGN_UP_PATH } from "@/features/auth";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createClient } from "@/lib/supabase/client";

// 判定中は/signupへの有効なリンクとして表示する。判定中に認証済みの利用者が
// 押しても、/signupの認証済みリダイレクトで/roundsへ着く。
export function StartButton() {
  const [href, setHref] = useState<string>(SIGN_UP_PATH);
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    createSupabaseAuth(createClient)
      .readSession()
      .then((reading) => {
        if (reading.status !== "unauthenticated") {
          setHref("/rounds");
        }
      })
      .finally(() => setDecided(true));
  }, []);

  return (
    <Link
      href={href}
      data-hydrated={decided ? "true" : undefined}
      className={buttonVariants({ variant: "default" })}
    >
      開始
    </Link>
  );
}
