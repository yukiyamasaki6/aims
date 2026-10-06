"use client";

import { useEffect } from "react";
import { getLocalIdentity } from "@/features/auth/local-identity";
import { createClient } from "@/lib/supabase/client";
import { roundOpHub } from "./(main)/rounds/_shared/round-op-hub";

// 操作の列の常駐の送信を、どの画面でも動かす。何も表示しない。
export function OpSyncProvider() {
  useEffect(() => {
    roundOpHub.start(getLocalIdentity());
    const handleOnline = () => roundOpHub.handleOnline();
    const handleOffline = () => roundOpHub.handleOffline();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const { data } = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        roundOpHub.setUser(null);
        return;
      }
      // セッションが無い`INITIAL_SESSION`は、オフラインで検証できないだけの可能性があるため何もしない。
      const id = session?.user.id;
      if (
        id &&
        (event === "SIGNED_IN" ||
          event === "INITIAL_SESSION" ||
          event === "TOKEN_REFRESHED")
      ) {
        if (id === roundOpHub.getUserId()) roundOpHub.resumeHeld();
        else roundOpHub.setUser(id);
      }
    });

    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      roundOpHub.stop();
    };
  }, []);

  return null;
}
