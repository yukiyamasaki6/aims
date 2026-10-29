"use client";

import { useState } from "react";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createClient } from "@/lib/supabase/client";
import { RoundPresetSelect } from "./round-preset-select-client";

export default function NewRoundPage() {
  // 画面を開いている間、同じ実装を保つ。
  const [sessionReader] = useState(() => createSupabaseAuth(createClient));
  const [identityReader] = useState(() => createBrowserIdentityStore());

  return (
    <RoundPresetSelect
      sessionReader={sessionReader}
      identityReader={identityReader}
    />
  );
}
