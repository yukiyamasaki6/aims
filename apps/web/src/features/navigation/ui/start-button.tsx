"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { Start } from "../application/start";

// 判定中はサインアップへの有効なリンクとして表示する。判定中に認証済みの利用者が
// 押しても、/signupの認証済みリダイレクトで/roundsへ着く。
export function StartButton({ start }: { start: Start }) {
  const [href, setHref] = useState(start.pendingHref);
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    start
      .decideHref()
      .then(setHref)
      .finally(() => setDecided(true));
  }, [start]);

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
