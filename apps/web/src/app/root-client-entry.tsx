"use client";

import { useEffect, useState } from "react";
import { createLocalIdentity } from "@/features/auth/application/local-identity";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createClient } from "@/lib/supabase/client";
import { OpSyncProvider } from "./op-sync-provider";
import { RoundBaseRefresher } from "./round-base-refresher";

// ルートレイアウトはサーバー専用のexport(メタデータ)を持ち、クライアントの処理を持てないため、この入口が起動地点の代わりに、アプリで1度だけ動く部品を生成して始め、常駐の部品へ渡す。
// 端末の識別情報の記録は、サインイン、サインアップを含む全ページで有効にする。表示は何も行わない。
export function RootClientEntry() {
  const [authenticator] = useState(() => createSupabaseAuth(createClient));
  const [identityStore] = useState(() => createBrowserIdentityStore());
  const [localIdentity] = useState(() =>
    createLocalIdentity({ changes: authenticator, writer: identityStore }),
  );
  useEffect(() => localIdentity.start(), [localIdentity]);

  return (
    <>
      <OpSyncProvider
        identityReader={identityStore}
        sessionReader={authenticator}
      />
      <RoundBaseRefresher sessionReader={authenticator} />
    </>
  );
}
