"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { classifySession } from "@/features/auth/session-state";
import { createClient } from "@/lib/supabase/client";

// 判定中は/signupへの有効なリンクとして表示する。判定中に認証済みの利用者が
// 押しても、/signupの認証済みリダイレクトで/roundsへ着く。
export function StartButton() {
  const [href, setHref] = useState("/signup");
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then((result) => {
        if (classifySession(result).status !== "unauthenticated") {
          setHref("/rounds");
        }
      })
      .catch(() => {})
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
