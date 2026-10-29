"use client";

import { type ReactNode, useEffect, useState } from "react";
import { createLocalIdentity } from "@/features/auth/application/local-identity";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createOpSender } from "@/features/round-sync/application/op-sender";
import { createRoundSync } from "@/features/round-sync/application/round-sync";
import { createSyncTriggers } from "@/features/round-sync/application/sync-triggers";
import { createAuthSessionCheck } from "@/features/round-sync/infrastructure/auth-session-check";
import { createAuthSignInSignals } from "@/features/round-sync/infrastructure/auth-sign-in-signals";
import { createBrowserSenderLock } from "@/features/round-sync/infrastructure/browser-sender-lock";
import { createBrowserVisibility } from "@/features/round-sync/infrastructure/browser-visibility";
import { createRoundsRecords } from "@/features/round-sync/infrastructure/rounds-records";
import { RoundBaseRefresher } from "@/features/round-sync/ui/round-base-refresher";
import { createContentFetcher } from "@/features/rounds/application/fetch-content";
import { createRoundFetching } from "@/features/rounds/application/fetch-round-detail";
import { createRefreshRequests } from "@/features/rounds/application/refresh-requests";
import { createRefreshRoundBases } from "@/features/rounds/application/refresh-round-bases";
import { createRoundReconciliation } from "@/features/rounds/application/round-reconciliation";
import { createRoundRecordHub } from "@/features/rounds/application/round-record-hub";
import { createRoundsStore } from "@/features/rounds/application/rounds-store";
import { createSendOperations } from "@/features/rounds/application/send-operations";
import type { RoundBaseRecord } from "@/features/rounds/domain/round-base";
import { roundStreamRules } from "@/features/rounds/domain/round-retention";
import type { SyncOperation } from "@/features/rounds/domain/sync-events";
import { createAuthSignInReader } from "@/features/rounds/infrastructure/auth-sign-in-reader";
import { createBrowserRecordChannel } from "@/features/rounds/infrastructure/browser-record-channel";
import { createReferenceSnapshots } from "@/features/rounds/infrastructure/reference-snapshot";
import { createRoundOpTransport } from "@/features/rounds/infrastructure/round-op-transport";
import { createRoundQueries } from "@/features/rounds/infrastructure/round-queries";
import { RoundsStoreProvider } from "@/features/rounds/ui/rounds-context";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createIndexedDbOpLogStore } from "@/lib/local-op-log/infrastructure/indexeddb-op-log-store";
import { createClient } from "@/lib/supabase/infrastructure/client";
import { createSupabaseDatabase } from "@/lib/supabase/infrastructure/database";
import { SwUpdateActivator } from "./sw-update-activator";

// アプリで1つの部品を、1度だけ生成して結ぶ。実行環境の大域の名前に触る実装は、開始の後に初めて触る(事前描画でも生成できる)。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: アプリで1つの部品を生成して結ぶ線で、分けても生成の順序が追いにくくなるだけである。
function composeApp() {
  const authenticator = createSupabaseAuth(createClient);
  const identityStore = createBrowserIdentityStore();
  const localIdentity = createLocalIdentity({
    changes: authenticator,
    writer: identityStore,
  });
  const connectivity = createBrowserConnectivity();
  const clock = createBrowserClock();
  const hub = createRoundRecordHub({
    store: createIndexedDbOpLogStore<SyncOperation, RoundBaseRecord>(
      roundStreamRules,
    ),
    channel: createBrowserRecordChannel(),
  });
  const database = createSupabaseDatabase(createClient);
  const requests = createRefreshRequests();
  const fetching = createRoundFetching({
    content: createContentFetcher({
      signIn: createAuthSignInReader(authenticator),
      connectivity,
      clock,
    }),
    queries: createRoundQueries(database),
    snapshots: createReferenceSnapshots(identityStore),
    clock,
  });
  const reconciliation = createRoundReconciliation({
    hub,
    requests,
    send: createSendOperations({
      hub,
      transport: createRoundOpTransport(database),
    }),
    refresh: createRefreshRoundBases({ hub, fetching, requests }),
  });
  const store = createRoundsStore({
    hub,
    requests,
    fetching,
    clock,
    connectivity,
  });
  const records = createRoundsRecords(reconciliation);
  const session = createAuthSessionCheck(authenticator);
  const sync = createRoundSync({
    records,
    sender: createOpSender({
      records,
      session,
      lock: createBrowserSenderLock(),
      clock,
      connectivity,
    }),
    session,
    clock,
    connectivity,
  });
  const triggers = createSyncTriggers({
    signals: createAuthSignInSignals({
      changes: authenticator,
      identityReader: identityStore,
    }),
    visibility: createBrowserVisibility(),
    connectivity,
    sync,
  });
  return { localIdentity, hub, store, sync, triggers };
}

// ルートレイアウトはサーバー専用のexport(メタデータ)を持ち、クライアントの処理を持てないため、この入口が起動地点の代わりに、アプリで1度だけ動く部品を生成して始め、アプリの全体を包んで、画面へ状態と変更の方法を渡す。
// 端末の識別情報の記録は、サインイン、サインアップを含む全ページで有効にする。
export function RootClientEntry({ children }: { children: ReactNode }) {
  const [app] = useState(composeApp);
  useEffect(() => app.localIdentity.start(), [app]);
  useEffect(() => app.triggers.start(), [app]);

  return (
    <RoundsStoreProvider store={app.store}>
      <RoundBaseRefresher sync={app.sync} />
      <SwUpdateActivator whenPersisted={app.hub.whenPersisted} />
      {children}
    </RoundsStoreProvider>
  );
}
