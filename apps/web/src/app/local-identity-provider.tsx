"use client";

import { useEffect, useState } from "react";
import { createLocalIdentity } from "@/features/auth/application/local-identity";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createClient } from "@/lib/supabase/client";

// サインイン、サインアップを含む全ページで有効にする必要があるため、ルートレイアウトにマウントする。
// ルートレイアウトはサーバー専用のexport(メタデータ)を持ち、クライアントの処理を持てないため、この入口が起動地点の代わりに生成して始める。
// 表示は何も行わない。
export function LocalIdentityProvider() {
  const [localIdentity] = useState(() =>
    createLocalIdentity({
      changes: createSupabaseAuth(createClient),
      writer: createBrowserIdentityStore(),
    }),
  );
  useEffect(() => localIdentity.start(), [localIdentity]);

  return null;
}
