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
import { createRoundDetailStore } from "@/features/rounds/application/round-detail-store";
import { createRoundReconciliation } from "@/features/rounds/application/round-reconciliation";
import { createRoundRecordHub } from "@/features/rounds/application/round-record-hub";
import { createRoundsListStore } from "@/features/rounds/application/rounds-list-store";
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
  RoundDetailStoreProvider,
  RoundsListStoreProvider,
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

// 入力(認証、識別情報の保存、接続、時計、データベース、遷移)。実行環境の大域の名前に触る実装は、開始の後に初めて触る(事前描画でも生成できる)。
// routerは画面のパッケージの遷移の部品で、アプリで1つ。
function composeInputs(router: PageRouter) {
  const authenticator = createSupabaseAuth(createClient);
  const identityStore = createBrowserIdentityStore();
  return {
    authenticator,
    identityStore,
    localIdentity: createLocalIdentity({
      changes: authenticator,
      writer: identityStore,
    }),
    signIn: createAuthSignInReader(authenticator),
    connectivity: createBrowserConnectivity(),
    clock: createBrowserClock(),
    database: narrowDatabase<RoundsDbSchema>(
      createSupabaseDatabase(createClient),
    ),
    navigation: createRouterNavigation(router),
  };
}

type Inputs = ReturnType<typeof composeInputs>;

// 記録と取得(記録のハブ、取り直しの依頼、取得、突き合わせ)。
function composeRecords(inputs: Inputs) {
  const { identityStore, signIn, connectivity, clock, database } = inputs;
  const hub = createRoundRecordHub({
    store: createIndexedDbOpLogStore<SyncOperation, RoundBaseRecord>(
      roundStreamRules,
    ),
    channel: createBrowserRecordChannel(),
  });
  const requests = createRefreshRequests();
  const snapshots = createReferenceSnapshots(identityStore);
  const fetching = createRoundFetching({
    content: createContentFetcher({ signIn, connectivity, clock }),
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
  return { hub, requests, snapshots, fetching, reconciliation };
}

type Records = ReturnType<typeof composeRecords>;

// 窓口(手続きと、一覧、作成、詳細の窓口)。
function composeStores(inputs: Inputs, records: Records) {
  const { signIn, connectivity, clock, database, navigation } = inputs;
  const { hub, requests, snapshots, fetching } = records;
  const ids = createBrowserUniqueIds();
  const commands = createPresetCommands(database);
  const deletion = createRoundDeletion({ hub, ids });
  return {
    detailStore: createRoundDetailStore({
      hub,
      requests,
      fetching,
      clock,
      connectivity,
      ids,
      leaving: createRoundLeaving({ hub, ids, navigation, deletion }),
      editing: createRoundEditing({ hub, ids }),
      presetSaving: createPresetSaving({ signIn, commands, fetching }),
    }),
    newRoundStore: createNewRoundStore({
      fetching,
      roundStart: createRoundStart({ hub, signIn, ids, clock, navigation }),
      presetDeletion: createPresetDeletion({ signIn, commands, snapshots }),
      connectivity,
    }),
    listStore: createRoundsListStore({
      hub,
      requests,
      fetching,
      clock,
      connectivity,
      deletion,
    }),
  };
}

// 同期(同期と、その契機)。
function composeSync(inputs: Inputs, records: Records) {
  const { authenticator, identityStore, connectivity, clock } = inputs;
  const sync = createRoundSync({
    records: records.reconciliation,
    sender: createOpSender({
      records: records.reconciliation,
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
  return { sync, triggers };
}

// アプリで1つの部品を、1度だけ生成して結ぶ。
function composeApp(router: PageRouter) {
  const inputs = composeInputs(router);
  const records = composeRecords(inputs);
  return {
    localIdentity: inputs.localIdentity,
    hub: records.hub,
    ...composeStores(inputs, records),
    ...composeSync(inputs, records),
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
        <RoundDetailStoreProvider store={app.detailStore}>
          <RoundBaseRefresher sync={app.sync} />
          <SwUpdateActivator whenPersisted={app.hub.whenPersisted} />
          {children}
        </RoundDetailStoreProvider>
      </NewRoundStoreProvider>
    </RoundsListStoreProvider>
  );
}
