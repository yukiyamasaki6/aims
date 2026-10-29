"use client";

import { useState } from "react";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createClient } from "@/lib/supabase/client";
import { RoundDetailClient } from "./round-detail-client";

// page.tsxはサーバー専用のexport(dynamicParams、generateStaticParams)を持ち、クライアントの処理を持てないため、この入口が画面の入口の一部として生成して渡す。
export function RoundDetailEntry() {
  // 画面を開いている間、同じ実装を保つ。
  const [sessionReader] = useState(() => createSupabaseAuth(createClient));
  const [identityReader] = useState(() => createBrowserIdentityStore());

  return (
    <RoundDetailClient
      sessionReader={sessionReader}
      identityReader={identityReader}
    />
  );
}
