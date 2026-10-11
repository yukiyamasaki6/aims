"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { refreshRoundBases } from "./(main)/rounds/[id]/refresh-round-bases";

// 取得を同時に1回までにする。実行中の契機は、完了後に1回だけやり直す。
export function createSingleFlight(run: () => Promise<void>) {
  let running = false;
  let again = false;
  return async function trigger() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await run();
      } while (again);
    } finally {
      running = false;
    }
  };
}

// 端末が、入力中のラウンドをオフラインで開けるよう、取得を契機ごとに行う。何も表示しない。
// 契機は、サインインの確認、通信の復帰、画面が見える状態になったとき。成功の回数は、取得の完了を確かめる手段として出す。
export function RoundBaseRefresher() {
  const [refreshed, setRefreshed] = useState(0);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    const trigger = createSingleFlight(async () => {
      if (await refreshRoundBases(supabase)) {
        if (active) setRefreshed((count) => count + 1);
      }
    });
    const handleOnline = () => void trigger();
    const handleVisible = () => {
      if (document.visibilityState === "visible") void trigger();
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisible);
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "INITIAL_SESSION" || event === "SIGNED_IN")) {
        void trigger();
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, []);

  return (
    <span
      hidden
      data-testid="round-base-refresher"
      data-refreshed-count={refreshed}
    />
  );
}
