"use client";

import { useState } from "react";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createClient } from "@/lib/supabase/infrastructure/client";
import { RoundDetailClient } from "./round-detail-client";

// page.tsxはサーバー専用のexport(dynamicParams、generateStaticParams)を持ち、クライアントの処理を持てないため、この入口が画面の入口の一部として生成して渡す。
export function RoundDetailEntry() {
  // 画面を開いている間、同じ実装を保つ。
  const [sessionReader] = useState(() => createSupabaseAuth(createClient));

  return <RoundDetailClient sessionReader={sessionReader} />;
}
