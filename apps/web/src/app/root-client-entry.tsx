"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { createLocalIdentity } from "@/features/auth/application/local-identity";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createOpSender } from "@/features/round-sync/application/op-sender";
import { createRoundSync } from "@/features/round-sync/application/round-sync";
import { createSyncTriggers } from "@/features/round-sync/application/sync-triggers";
import { createBrowserSenderLock } from "@/features/round-sync/infrastructure/browser-sender-lock";
import { createBrowserVisibility } from "@/features/round-sync/infrastructure/browser-visibility";
import { RoundBaseRefresher } from "@/features/round-sync/ui/round-base-refresher";
import { createPresetDeletion } from "@/features/rounds/application/delete-preset";
import { createRoundDeletion } from "@/features/rounds/application/delete-round";
import { createRoundEditing } from "@/features/rounds/application/edit-round";
import { createContentFetcher } from "@/features/rounds/application/fetch-content";
import { createRoundFetching } from "@/features/rounds/application/fetch-round-detail";
import { createRoundLeaving } from "@/features/rounds/application/leave-round";
import { createNewRoundStore } from "@/features/rounds/application/new-round-store";
import { createRefreshRequests } from "@/features/rounds/application/refresh-requests";
import { createRefreshRoundBases } from "@/features/rounds/application/refresh-round-bases";
import { createRoundReconciliation } from "@/features/rounds/application/round-reconciliation";
import { createRoundRecordHub } from "@/features/rounds/application/round-record-hub";
import { createRoundsListStore } from "@/features/rounds/application/rounds-list-store";
import { createRoundsStore } from "@/features/rounds/application/rounds-store";
import { createPresetSaving } from "@/features/rounds/application/save-preset";
import { createSendOperations } from "@/features/rounds/application/send-operations";
import { createRoundStart } from "@/features/rounds/application/start-round";
import type { RoundBaseRecord } from "@/features/rounds/domain/round-base";
import { roundStreamRules } from "@/features/rounds/domain/round-retention";
import type { SyncOperation } from "@/features/rounds/domain/sync-events";
import { createAuthSignInReader } from "@/features/rounds/infrastructure/auth-sign-in-reader";
import { createBrowserRecordChannel } from "@/features/rounds/infrastructure/browser-record-channel";
import { createBrowserUniqueIds } from "@/features/rounds/infrastructure/browser-unique-ids";
import { createPresetCommands } from "@/features/rounds/infrastructure/preset-commands";
import { createReferenceSnapshots } from "@/features/rounds/infrastructure/reference-snapshot";
import { createRoundOpTransport } from "@/features/rounds/infrastructure/round-op-transport";
import { createRoundQueries } from "@/features/rounds/infrastructure/round-queries";
import type { RoundsDbSchema } from "@/features/rounds/infrastructure/rounds-db-schema";
import {
  createRouterNavigation,
  type PageRouter,
} from "@/features/rounds/infrastructure/router-navigation";
import {
  NewRoundStoreProvider,
  RoundsListStoreProvider,
  RoundsStoreProvider,
} from "@/features/rounds/ui/rounds-context";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createIndexedDbOpLogStore } from "@/lib/local-op-log/infrastructure/indexeddb-op-log-store";
import { createClient } from "@/lib/supabase/infrastructure/client";
import {
  createSupabaseDatabase,
  narrowDatabase,
} from "@/lib/supabase/infrastructure/database";
import { SwUpdateActivator } from "./sw-update-activator";

// アプリで1つの部品を、1度だけ生成して結ぶ。実行環境の大域の名前に触る実装は、開始の後に初めて触る(事前描画でも生成できる)。
// routerは画面のパッケージの遷移の部品で、アプリで1つ。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: アプリで1つの部品を生成して結ぶ線で、分けても生成の順序が追いにくくなるだけである。
function composeApp(router: PageRouter) {
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
  const database = narrowDatabase<RoundsDbSchema>(
    createSupabaseDatabase(createClient),
  );
  const requests = createRefreshRequests();
  const signIn = createAuthSignInReader(authenticator);
  const snapshots = createReferenceSnapshots(identityStore);
  const ids = createBrowserUniqueIds();
  const fetching = createRoundFetching({
    content: createContentFetcher({
      signIn,
      connectivity,
      clock,
    }),
    queries: createRoundQueries(database),
    snapshots,
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
  const navigation = createRouterNavigation(router);
  const commands = createPresetCommands(database);
  const deletion = createRoundDeletion({ hub, ids });
  const roundStart = createRoundStart({ hub, signIn, ids, clock, navigation });
  const presetDeletion = createPresetDeletion({ signIn, commands, snapshots });
  const store = createRoundsStore({
    hub,
    requests,
    fetching,
    clock,
    connectivity,
    ids,
    leaving: createRoundLeaving({ hub, ids, navigation, deletion }),
    editing: createRoundEditing({ hub, ids }),
    presetSaving: createPresetSaving({ signIn, commands, fetching }),
  });
  const newRoundStore = createNewRoundStore({
    fetching,
    roundStart,
    presetDeletion,
    connectivity,
  });
  const listStore = createRoundsListStore({
    hub,
    requests,
    fetching,
    clock,
    connectivity,
    deletion,
  });
  const sync = createRoundSync({
    records: reconciliation,
    sender: createOpSender({
      records: reconciliation,
      session: authenticator,
      lock: createBrowserSenderLock(),
      clock,
      connectivity,
    }),
    session: authenticator,
    clock,
    connectivity,
  });
  const triggers = createSyncTriggers({
    identityReader: identityStore,
    changes: authenticator,
    visibility: createBrowserVisibility(),
    connectivity,
    sync,
  });
  return {
    localIdentity,
    hub,
    store,
    listStore,
    newRoundStore,
    sync,
    triggers,
  };
}

// ルートレイアウトはサーバー専用のexport(メタデータ)を持ち、クライアントの処理を持てないため、この入口が起動地点の代わりに、アプリで1度だけ動く部品を生成して始め、アプリの全体を包んで、画面へ状態と変更の方法を渡す。
// 端末の識別情報の記録は、サインイン、サインアップを含む全ページで有効にする。
export function RootClientEntry({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [app] = useState(() => composeApp(router));
  useEffect(() => app.localIdentity.start(), [app]);
  useEffect(() => app.triggers.start(), [app]);

  return (
    <RoundsListStoreProvider store={app.listStore}>
      <NewRoundStoreProvider store={app.newRoundStore}>
        <RoundsStoreProvider store={app.store}>
          <RoundBaseRefresher sync={app.sync} />
          <SwUpdateActivator whenPersisted={app.hub.whenPersisted} />
          {children}
        </RoundsStoreProvider>
      </NewRoundStoreProvider>
    </RoundsListStoreProvider>
  );
}
