"use client";

import { useState } from "react";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createClient } from "@/lib/supabase/client";
import { RoundsListClient } from "./rounds-list-client";

export default function RoundsPage() {
  // 画面を開いている間、同じ実装を保つ。
  const [sessionReader] = useState(() => createSupabaseAuth(createClient));
  const [identityReader] = useState(() => createBrowserIdentityStore());

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col gap-6 p-8">
      <h1 className="font-heading text-2xl leading-snug font-medium">
        ラウンド一覧
      </h1>

      <RoundsListClient
        sessionReader={sessionReader}
        identityReader={identityReader}
      />
    </main>
  );
}
