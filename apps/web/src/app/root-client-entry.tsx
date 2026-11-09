"use client";

import { useRouter } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { createLocalIdentity } from "@/features/auth/application/local-identity";
import { createSession } from "@/features/auth/application/session";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createBrowserPageLoad } from "@/features/auth/infrastructure/browser-page-load";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SessionProvider } from "@/features/auth/ui/session-context";
import { createUpdateActivation } from "@/features/offline-pwa/application/update-activation";
import { createBrowserLinkClicks } from "@/features/offline-pwa/infrastructure/browser-link-clicks";
import { createBrowserServiceWorker } from "@/features/offline-pwa/infrastructure/browser-service-worker";
import { SwUpdateActivator } from "@/features/offline-pwa/ui/sw-update-activator";
import { createRoundSync } from "@/features/round-sync/application/round-sync";
import { createSyncTriggers } from "@/features/round-sync/application/sync-triggers";
import { createBrowserVisibility } from "@/features/round-sync/infrastructure/browser-visibility";
import { createContentFetcher } from "@/features/rounds/application/content-fetcher";
import { createNewRoundStore } from "@/features/rounds/application/new-round-store";
import { createOpSender } from "@/features/rounds/application/op-sender";
import { createOperationSending } from "@/features/rounds/application/operation-sending";
import { createPresetDeletion } from "@/features/rounds/application/preset-deletion";
import { createPresetSaving } from "@/features/rounds/application/preset-saving";
import { createRefreshRequests } from "@/features/rounds/application/refresh-requests";
import { createRoundBaseRefreshing } from "@/features/rounds/application/round-base-refreshing";
import { createRoundDeletion } from "@/features/rounds/application/round-deletion";
import { createRoundDetailStore } from "@/features/rounds/application/round-detail-store";
import { createRoundEditing } from "@/features/rounds/application/round-editing";
import { createRoundFetching } from "@/features/rounds/application/round-fetching";
import { createRoundLeaving } from "@/features/rounds/application/round-leaving";
import { createRoundRecordControl } from "@/features/rounds/application/round-record-control";
import { createRoundRecordHub } from "@/features/rounds/application/round-record-hub";
import { createRoundRefreshControl } from "@/features/rounds/application/round-refresh-control";
import { createRoundStart } from "@/features/rounds/application/round-start";
import { createRoundsListStore } from "@/features/rounds/application/rounds-list-store";
import { FALLBACK_WAIT_MS } from "@/features/rounds/domain/fetch-wait";
import type { RoundBaseRecord } from "@/features/rounds/domain/round-base";
import { roundStreamRules } from "@/features/rounds/domain/round-retention";
import type { SyncOperation } from "@/features/rounds/domain/sync-events";
import { createBrowserUniqueIds } from "@/features/rounds/infrastructure/browser-unique-ids";
import { createPresetCommands } from "@/features/rounds/infrastructure/preset-commands";
import { createReferenceSnapshots } from "@/features/rounds/infrastructure/reference-snapshot";
import { createRoundOpTransport } from "@/features/rounds/infrastructure/round-op-transport";
import { createRoundQueries } from "@/features/rounds/infrastructure/round-queries";
import type { RoundsDbSchema } from "@/features/rounds/infrastructure/rounds-db-schema";
import {
  NewRoundStoreProvider,
  RoundDetailStoreProvider,
  RoundProceduresProvider,
  RoundsListStoreProvider,
} from "@/features/rounds/ui/rounds-context";
import { intlConfig } from "@/i18n/messages";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createIndexedDbOpLogStore } from "@/lib/local-op-log/infrastructure/indexeddb-op-log-store";
import {
  createRouterPageNavigation,
  type PageRouter,
} from "@/lib/page-navigation/infrastructure/router-page-navigation";
import { createClient } from "@/lib/supabase/infrastructure/client";
import { createSupabaseDatabase } from "@/lib/supabase/infrastructure/database";

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
    sessionReader: authenticator,
    connectivity: createBrowserConnectivity(),
    clock: createBrowserClock(),
    database: createSupabaseDatabase<RoundsDbSchema>(createClient),
    pageNavigation: createRouterPageNavigation(router),
  };
}

type Inputs = ReturnType<typeof composeInputs>;

// 記録と取得(記録のハブ、取り直しの依頼、取得、送信、記録の制御、取り直しの制御)。
function composeRecords(inputs: Inputs) {
  const { identityStore, sessionReader, connectivity, clock, database } =
    inputs;
  const hub = createRoundRecordHub({
    store: createIndexedDbOpLogStore<SyncOperation, RoundBaseRecord>(
      roundStreamRules,
    ),
  });
  const requests = createRefreshRequests();
  const snapshots = createReferenceSnapshots(identityStore);
  const fetching = createRoundFetching({
    content: createContentFetcher({ sessionReader, connectivity, clock }),
    queries: createRoundQueries(database),
    snapshots,
    clock,
  });
  const sender = createOpSender({
    hub,
    sending: createOperationSending({
      hub,
      transport: createRoundOpTransport(database),
    }),
    sessionReader,
    clock,
    connectivity,
  });
  const control = createRoundRecordControl({ hub, sender });
  const refresh = createRoundRefreshControl({
    hub,
    requests,
    refresh: createRoundBaseRefreshing({ hub, fetching, requests }),
  });
  return { hub, requests, snapshots, fetching, control, refresh };
}

type Records = ReturnType<typeof composeRecords>;

// 窓口(手続きと、一覧、作成、詳細の窓口)。
function composeStores(inputs: Inputs, records: Records) {
  const { sessionReader, connectivity, clock, database, pageNavigation } =
    inputs;
  const { hub, requests, snapshots, fetching } = records;
  const ids = createBrowserUniqueIds();
  const commands = createPresetCommands(database);
  const deletion = createRoundDeletion({ hub, ids });
  const leaving = createRoundLeaving({ hub, ids, pageNavigation, deletion });
  const presetSaving = createPresetSaving({
    sessionReader,
    commands,
    fetching,
  });
  return {
    procedures: { leaving, deletion, presetSaving, ids },
    detailStore: createRoundDetailStore({
      hub,
      requests,
      fetching,
      clock,
      connectivity,
      ids,
      editing: createRoundEditing({ hub, ids }),
    }),
    newRoundStore: createNewRoundStore({
      fetching,
      roundStart: createRoundStart({
        hub,
        sessionReader,
        ids,
        clock,
        pageNavigation,
      }),
      presetDeletion: createPresetDeletion({
        sessionReader,
        commands,
        snapshots,
      }),
      connectivity,
    }),
    listStore: createRoundsListStore({
      hub,
      fetching,
      clock,
      connectivity,
    }),
  };
}

// 同期(同期と、その契機)。
function composeSync(inputs: Inputs, records: Records) {
  const { authenticator, identityStore, connectivity } = inputs;
  const sync = createRoundSync({
    control: records.control,
    refresh: records.refresh,
    session: authenticator,
    connectivity,
  });
  const triggers = createSyncTriggers({
    identityReader: identityStore,
    changes: authenticator,
    visibility: createBrowserVisibility(),
    connectivity,
    sync,
  });
  return { triggers };
}

// オフラインとアプリの更新(Service Workerの更新の切り替え)。
function composeOffline(inputs: Inputs, records: Records) {
  const swUpdate = createUpdateActivation({
    host: createBrowserServiceWorker(),
    links: createBrowserLinkClicks(),
    persistence: records.hub,
    clock: inputs.clock,
    deadlineMs: FALLBACK_WAIT_MS,
  });
  return { swUpdate };
}

// セッション(サインアウトと、セッションの喪失の見張り)。
// 記録の利用者の照合は記録の制御に任せる。
function composeSession(inputs: Inputs, records: Records) {
  return createSession({
    authenticator: inputs.authenticator,
    pageReplace: createBrowserPageLoad(),
    recordUser: records.control,
  });
}

// アプリで1つの部品を、1度だけ生成して結ぶ。
function composeApp(router: PageRouter) {
  const inputs = composeInputs(router);
  const records = composeRecords(inputs);
  return {
    localIdentity: inputs.localIdentity,
    session: composeSession(inputs, records),
    ...composeStores(inputs, records),
    ...composeSync(inputs, records),
    ...composeOffline(inputs, records),
  };
}

// ルートレイアウトはサーバー専用のexport(メタデータ)を持ち、クライアントの処理を持てないため、この入口が起動地点の代わりに、アプリで1度だけ動く部品を生成して始め、アプリの全体を包んで、画面へ状態と変更の方法を渡す。
// 端末の識別情報の記録は、サインイン、サインアップを含む全ページで有効にする。
export function RootClientEntry({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [app] = useState(() => composeApp(router));
  useEffect(() => app.localIdentity.start(), [app]);
  useEffect(() => app.triggers.start(), [app]);
  useEffect(() => app.swUpdate.start(), [app]);

  // getMessageFallbackとonErrorは関数で、サーバーから渡せないため、クライアントのこの入口で設定を直接読み込む。
  return (
    <NextIntlClientProvider {...intlConfig}>
      <RoundsListStoreProvider store={app.listStore}>
        <NewRoundStoreProvider store={app.newRoundStore}>
          <RoundDetailStoreProvider store={app.detailStore}>
            <RoundProceduresProvider procedures={app.procedures}>
              <SessionProvider session={app.session}>
                <SwUpdateActivator activation={app.swUpdate} />
                {children}
              </SessionProvider>
            </RoundProceduresProvider>
          </RoundDetailStoreProvider>
        </NewRoundStoreProvider>
      </RoundsListStoreProvider>
    </NextIntlClientProvider>
  );
}
