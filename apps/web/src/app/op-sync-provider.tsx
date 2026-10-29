"use client";

import { useEffect } from "react";
import type { IdentityReader, SessionReader } from "@/features/auth";
import { roundOpHub } from "@/features/rounds/round-op-hub";
import { createClient } from "@/lib/supabase/client";

// 操作の列の常駐の送信を、どの画面でも動かす。何も表示しない。
export function OpSyncProvider({
  identityReader,
  sessionReader,
}: {
  identityReader: IdentityReader;
  sessionReader: SessionReader;
}) {
  useEffect(() => {
    roundOpHub.start(identityReader.read(), sessionReader);
    const handleOnline = () => roundOpHub.handleOnline();
    window.addEventListener("online", handleOnline);

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
      roundOpHub.stop();
    };
  }, [identityReader, sessionReader]);

  return null;
}
