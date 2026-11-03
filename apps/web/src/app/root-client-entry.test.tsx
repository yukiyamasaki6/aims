import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalIdentity } from "@/features/auth/application/local-identity";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import {
  createUpdateActivation,
  type UpdateActivation,
} from "@/features/offline-pwa/application/update-activation";
import { createOpSender } from "@/features/round-sync/application/op-sender";
import { createRoundSync } from "@/features/round-sync/application/round-sync";
import { createSyncTriggers } from "@/features/round-sync/application/sync-triggers";
import { createContentFetcher } from "@/features/rounds/application/content-fetcher";
import { createNewRoundStore } from "@/features/rounds/application/new-round-store";
import { createPresetDeletion } from "@/features/rounds/application/preset-deletion";
import { createPresetSaving } from "@/features/rounds/application/preset-saving";
import { createRoundDeletion } from "@/features/rounds/application/round-deletion";
import { createRoundDetailStore } from "@/features/rounds/application/round-detail-store";
import { createRoundEditing } from "@/features/rounds/application/round-editing";
import { createRoundFetching } from "@/features/rounds/application/round-fetching";
import { createRoundLeaving } from "@/features/rounds/application/round-leaving";
import { createRoundRecordHub } from "@/features/rounds/application/round-record-hub";
import { createRoundStart } from "@/features/rounds/application/round-start";
import { createRoundsListStore } from "@/features/rounds/application/rounds-list-store";
import { FALLBACK_WAIT_MS } from "@/features/rounds/domain/fetch-result";
import { roundCreated } from "@/features/rounds/domain/round-op-test-helpers";
import { createAuthSignInReader } from "@/features/rounds/infrastructure/auth-sign-in-reader";
import { createBrowserUniqueIds } from "@/features/rounds/infrastructure/browser-unique-ids";
import { createPresetCommands } from "@/features/rounds/infrastructure/preset-commands";
import { createReferenceSnapshots } from "@/features/rounds/infrastructure/reference-snapshot";
import { createRoundQueries } from "@/features/rounds/infrastructure/round-queries";
import { useRoundDetailStore } from "@/features/rounds/ui/rounds-context";
import { createRouterPageNavigation } from "@/lib/page-navigation/infrastructure/router-page-navigation";
import { RootClientEntry } from "./root-client-entry";

// Supabaseクライアントは外部サービスとの境界のため、認証状態の変化を任意に発火できるスタブで模す。
const supabase = vi.hoisted(() => {
  const listeners: Array<
    (event: string, session: { user: { id: string } } | null) => void
  > = [];
  const unsubscribe = vi.fn();
  return {
    listeners,
    unsubscribe,
    createBrowserClient: vi.fn(() => ({
      auth: {
        onAuthStateChange: (listener: (typeof listeners)[number]) => {
          listeners.push(listener);
          // 解除すると、実際にこのリスナーへ以降の出来事が届かなくなる。
          const stop = () => {
            unsubscribe();
            listeners.splice(listeners.indexOf(listener), 1);
          };
          return { data: { subscription: { unsubscribe: stop } } };
        },
        // サインインの確認は、通信できない状態(確かめられない)にする。
        getSession: async () => {
          throw new Error("offline");
        },
      },
    })),
    emit(event: string, session: { user: { id: string } } | null) {
      for (const listener of [...listeners]) listener(event, session);
    },
  };
});
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: supabase.createBrowserClient,
}));

// 端末の保存(IndexedDB)は別のテストで確かめるため、メモリの保存先に差し替え、保存の完了を止められるようにする。
const storage = vi.hoisted(() => ({
  hold: false,
  release: null as null | (() => void),
}));
vi.mock(
  "@/lib/local-op-log/infrastructure/indexeddb-op-log-store",
  async () => {
    const { createMemoryOpLogStore } = await import(
      "@/lib/local-op-log/memory-op-log-store-test-helpers"
    );
    return {
      createIndexedDbOpLogStore: (
        rules: Parameters<typeof createMemoryOpLogStore>[0],
      ) => {
        const store = createMemoryOpLogStore(rules);
        const append = store.append.bind(store);
        store.append = async (...args) => {
          if (storage.hold) {
            await new Promise<void>((resolve) => {
              storage.release = resolve;
            });
          }
          return append(...args);
        };
        return store;
      },
    };
  },
);

// 画面のパッケージの遷移の部品は外部の境界のため、pushとreplaceを持つ1つの偽の部品に差し替える。
const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router }));

// 再読み込みを担う別の入口は別のテストで確かめるため、受け取ったpropsを記録する代役に差し替える。
const activator = vi.hoisted(() => ({
  props: [] as { activation: UpdateActivation }[],
}));
vi.mock("@/features/offline-pwa/ui/sw-update-activator", () => ({
  SwUpdateActivator: (props: { activation: UpdateActivation }) => {
    activator.props.push(props);
    return null;
  },
}));
vi.mock(
  "@/features/offline-pwa/application/update-activation",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/offline-pwa/application/update-activation")
      >();
    // 起動と停止の呼び出しを観測するため、実物のstartと、その停止関数を記録する関数で包む。
    return {
      createUpdateActivation: vi.fn(
        (...args: Parameters<typeof actual.createUpdateActivation>) => {
          const activation = actual.createUpdateActivation(...args);
          return {
            pathChanged: activation.pathChanged,
            start: vi.fn(() => vi.fn(activation.start())),
          };
        },
      ),
    };
  },
);

// 生成した部品の引数と実体を観測するため、実物を呼び通す記録に包む。
type RoundSyncInstance = ReturnType<typeof createRoundSync>;
const built = vi.hoisted(() => ({ syncs: [] as unknown[] }));
vi.mock(
  "@/features/auth/application/local-identity",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/auth/application/local-identity")
      >();
    return { createLocalIdentity: vi.fn(actual.createLocalIdentity) };
  },
);
vi.mock(
  "@/features/rounds/application/round-record-hub",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/round-record-hub")
      >();
    return { createRoundRecordHub: vi.fn(actual.createRoundRecordHub) };
  },
);
vi.mock(
  "@/features/rounds/application/round-detail-store",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/round-detail-store")
      >();
    return {
      ...actual,
      createRoundDetailStore: vi.fn(actual.createRoundDetailStore),
    };
  },
);
vi.mock(
  "@/features/rounds/application/rounds-list-store",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/rounds-list-store")
      >();
    return {
      ...actual,
      createRoundsListStore: vi.fn(actual.createRoundsListStore),
    };
  },
);
vi.mock(
  "@/features/rounds/application/round-deletion",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/round-deletion")
      >();
    return {
      ...actual,
      createRoundDeletion: vi.fn(actual.createRoundDeletion),
    };
  },
);
vi.mock(
  "@/features/rounds/application/new-round-store",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/new-round-store")
      >();
    return {
      ...actual,
      createNewRoundStore: vi.fn(actual.createNewRoundStore),
    };
  },
);
vi.mock(
  "@/features/rounds/infrastructure/auth-sign-in-reader",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/infrastructure/auth-sign-in-reader")
      >();
    return {
      createAuthSignInReader: vi.fn(actual.createAuthSignInReader),
    };
  },
);
vi.mock(
  "@/features/rounds/infrastructure/browser-unique-ids",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/infrastructure/browser-unique-ids")
      >();
    return {
      ...actual,
      createBrowserUniqueIds: vi.fn(actual.createBrowserUniqueIds),
    };
  },
);
vi.mock(
  "@/lib/page-navigation/infrastructure/router-page-navigation",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/page-navigation/infrastructure/router-page-navigation")
      >();
    return {
      ...actual,
      createRouterPageNavigation: vi.fn(actual.createRouterPageNavigation),
    };
  },
);
vi.mock(
  "@/features/rounds/infrastructure/preset-commands",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/infrastructure/preset-commands")
      >();
    return {
      ...actual,
      createPresetCommands: vi.fn(actual.createPresetCommands),
    };
  },
);
vi.mock(
  "@/features/rounds/infrastructure/reference-snapshot",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/infrastructure/reference-snapshot")
      >();
    return {
      ...actual,
      createReferenceSnapshots: vi.fn(actual.createReferenceSnapshots),
    };
  },
);
vi.mock(
  "@/features/rounds/infrastructure/round-queries",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/infrastructure/round-queries")
      >();
    return { ...actual, createRoundQueries: vi.fn(actual.createRoundQueries) };
  },
);
vi.mock(
  "@/features/rounds/application/round-editing",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/round-editing")
      >();
    return { ...actual, createRoundEditing: vi.fn(actual.createRoundEditing) };
  },
);
vi.mock(
  "@/features/rounds/application/round-leaving",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/round-leaving")
      >();
    return { ...actual, createRoundLeaving: vi.fn(actual.createRoundLeaving) };
  },
);
vi.mock(
  "@/features/rounds/application/preset-saving",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/preset-saving")
      >();
    return {
      ...actual,
      createPresetSaving: vi.fn(actual.createPresetSaving),
    };
  },
);
vi.mock("@/features/rounds/application/round-start", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/features/rounds/application/round-start")
    >();
  return { ...actual, createRoundStart: vi.fn(actual.createRoundStart) };
});
vi.mock(
  "@/features/rounds/application/preset-deletion",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/preset-deletion")
      >();
    return {
      ...actual,
      createPresetDeletion: vi.fn(actual.createPresetDeletion),
    };
  },
);
vi.mock(
  "@/features/rounds/application/content-fetcher",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/content-fetcher")
      >();
    return {
      ...actual,
      createContentFetcher: vi.fn(actual.createContentFetcher),
    };
  },
);
vi.mock(
  "@/features/rounds/application/round-fetching",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/round-fetching")
      >();
    return {
      ...actual,
      createRoundFetching: vi.fn(actual.createRoundFetching),
    };
  },
);
vi.mock(
  "@/features/round-sync/application/op-sender",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/round-sync/application/op-sender")
      >();
    return { createOpSender: vi.fn(actual.createOpSender) };
  },
);
vi.mock(
  "@/features/round-sync/application/round-sync",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/round-sync/application/round-sync")
      >();
    return {
      createRoundSync: vi.fn(
        (deps: Parameters<typeof actual.createRoundSync>[0]) => {
          const sync = actual.createRoundSync(deps);
          built.syncs.push(sync);
          return sync;
        },
      ),
    };
  },
);
vi.mock(
  "@/features/round-sync/application/sync-triggers",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/round-sync/application/sync-triggers")
      >();
    return { createSyncTriggers: vi.fn(actual.createSyncTriggers) };
  },
);

beforeEach(() => {
  vi.clearAllMocks();
  supabase.listeners.length = 0;
  activator.props.length = 0;
  built.syncs.length = 0;
  storage.hold = false;
  storage.release = null;
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const lastSync = () => built.syncs.at(-1) as RoundSyncInstance;

// 子の画面が、ラウンドの状態と変更の方法を受け取って追記する。
function Appender({
  onStore,
}: {
  onStore: (store: ReturnType<typeof useRoundDetailStore>) => void;
}) {
  onStore(useRoundDetailStore());
  return <p>子要素</p>;
}

describe("RootClientEntry", () => {
  describe("マウント", () => {
    it("子要素を描き、常駐の部品は何も表示しない(成功の回数の観測点だけを隠して置く)", () => {
      // Given
      const element = (
        <RootClientEntry>
          <p>子要素</p>
        </RootClientEntry>
      );

      // When
      render(element);

      // Then
      expect(screen.getByText("子要素")).toBeInTheDocument();
      expect(screen.getByTestId("round-base-refresher")).toHaveAttribute(
        "hidden",
      );
    });

    it("画面の遷移で待機中の新SWを有効にするSwUpdateActivatorを含め、更新の切り替えの手続きを渡す", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createUpdateActivation).toHaveBeenCalledTimes(1);
      expect(activator.props).toHaveLength(1);
      expect(activator.props[0].activation).toBe(
        vi.mocked(createUpdateActivation).mock.results[0].value,
      );
    });

    it("更新の切り替えの手続きは、期限に代わりがある待ちの上限(FALLBACK_WAIT_MS)と、アプリの時計、記録のハブの保存の待ちを受ける", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      const deps = vi.mocked(createUpdateActivation).mock.calls[0][0];
      expect(deps.deadlineMs).toBe(FALLBACK_WAIT_MS);
      expect(deps.persistence.whenPersisted).toBeTypeOf("function");
      expect(deps.clock.now()).toBeTypeOf("number");
    });

    it("起動すると、更新の切り替えの手続きを1回だけ始める", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      const activation = vi.mocked(createUpdateActivation).mock.results[0]
        .value;
      expect(activation.start).toHaveBeenCalledTimes(1);
    });

    it("サインインしたユーザーを端末ローカルの識別ユーザーとして記録する", () => {
      // Given
      render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      act(() => supabase.emit("SIGNED_IN", { user: { id: "user-1" } }));

      // Then
      expect(createBrowserIdentityStore().read()).toBe("user-1");
    });

    it("サインアウトすると、記録を消す", () => {
      // Given
      render(<RootClientEntry>{null}</RootClientEntry>);
      act(() => supabase.emit("SIGNED_IN", { user: { id: "user-1" } }));

      // When
      act(() => supabase.emit("SIGNED_OUT", null));

      // Then
      expect(createBrowserIdentityStore().read()).toBeNull();
    });

    it("復元されたセッション(INITIAL_SESSION)でも記録し、セッションが無いときは既存の記録を消さない", () => {
      // Given
      render(<RootClientEntry>{null}</RootClientEntry>);
      act(() => supabase.emit("INITIAL_SESSION", { user: { id: "user-1" } }));

      // When
      act(() => supabase.emit("INITIAL_SESSION", null));

      // Then
      expect(createBrowserIdentityStore().read()).toBe("user-1");
    });

    it("トークンの更新では、識別情報を変えず、消さない", () => {
      // Given
      render(<RootClientEntry>{null}</RootClientEntry>);
      act(() => supabase.emit("SIGNED_IN", { user: { id: "user-1" } }));

      // When
      act(() => supabase.emit("TOKEN_REFRESHED", { user: { id: "user-1" } }));

      // Then
      expect(createBrowserIdentityStore().read()).toBe("user-1");
    });
  });

  describe("組み立て", () => {
    it("記録のハブ、送信器、同期の手続きは1度だけ生成し、再描画で作り直さない", () => {
      // Given
      const { rerender } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      rerender(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createRoundRecordHub).toHaveBeenCalledTimes(1);
      expect(createOpSender).toHaveBeenCalledTimes(1);
      expect(createRoundSync).toHaveBeenCalledTimes(1);
      expect(createLocalIdentity).toHaveBeenCalledTimes(1);
    });

    it("記録の手続きと同期の契機が、認証の実装と識別情報の保存先をそれぞれ1つ共有する", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      const { changes, writer } =
        vi.mocked(createLocalIdentity).mock.calls[0][0];
      const triggers = vi.mocked(createSyncTriggers).mock.calls[0][0];
      expect(triggers.changes).toBe(changes);
      expect(triggers.identityReader).toBe(writer);
    });

    it("新しいIDの払い出しは1度だけ生成し、ラウンドの状態と変更の方法へ渡して、再描画で作り直さない", () => {
      // Given
      const { rerender } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      rerender(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createBrowserUniqueIds).toHaveBeenCalledTimes(1);
      expect(createRoundDetailStore).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createRoundDetailStore).mock.calls[0][0].ids).toBe(
        vi.mocked(createBrowserUniqueIds).mock.results[0].value,
      );
    });

    it("遷移の実装は、useRouter()が返した遷移の部品で1度だけ生成し、再描画で作り直さない", () => {
      // Given
      const { rerender } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      rerender(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createRouterPageNavigation).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createRouterPageNavigation).mock.calls[0][0]).toBe(
        nav.router,
      );
    });

    it("開始の手続きは1度だけ生成し、遷移、IDの実装、サインインの読み取りを受ける", () => {
      // Given
      const { rerender } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      rerender(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createRoundStart).toHaveBeenCalledTimes(1);
      const deps = vi.mocked(createRoundStart).mock.calls[0][0];
      expect(deps.pageNavigation).toBe(
        vi.mocked(createRouterPageNavigation).mock.results[0].value,
      );
      expect(deps.ids).toBe(
        vi.mocked(createBrowserUniqueIds).mock.results[0].value,
      );
      expect(deps.signIn).toBe(
        vi.mocked(createAuthSignInReader).mock.results[0].value,
      );
    });

    it("削除の手続きは1度だけ生成し、プリセットの書き込み、サインインの読み取り、保存済みを受ける", () => {
      // Given
      const { rerender } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      rerender(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createPresetDeletion).toHaveBeenCalledTimes(1);
      const deps = vi.mocked(createPresetDeletion).mock.calls[0][0];
      expect(deps.commands).toBe(
        vi.mocked(createPresetCommands).mock.results[0].value,
      );
      expect(deps.signIn).toBe(
        vi.mocked(createAuthSignInReader).mock.results[0].value,
      );
      expect(deps.snapshots).toBe(
        vi.mocked(createReferenceSnapshots).mock.results[0].value,
      );
    });

    it("完了と削除と一覧へ戻る手続きは1度だけ生成し、記録のハブ、IDの実装、遷移の実装を受け、再描画で作り直さない", () => {
      // Given
      const { rerender } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      rerender(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createRoundLeaving).toHaveBeenCalledTimes(1);
      const deps = vi.mocked(createRoundLeaving).mock.calls[0][0];
      expect(deps.hub).toBe(
        vi.mocked(createRoundRecordHub).mock.results[0].value,
      );
      expect(deps.ids).toBe(
        vi.mocked(createBrowserUniqueIds).mock.results[0].value,
      );
      expect(deps.pageNavigation).toBe(
        vi.mocked(createRouterPageNavigation).mock.results[0].value,
      );
    });

    it("追記の手続きは1度だけ生成し、記録のハブと払い出しを受け、窓口の依存へ渡して、再描画で作り直さない", () => {
      // Given
      const { rerender } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      rerender(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createRoundEditing).toHaveBeenCalledTimes(1);
      const deps = vi.mocked(createRoundEditing).mock.calls[0][0];
      const leaving = vi.mocked(createRoundLeaving).mock.calls[0][0];
      expect(deps.hub).toBe(leaving.hub);
      expect(deps.ids).toBe(leaving.ids);
      expect(vi.mocked(createRoundDetailStore).mock.calls[0][0].editing).toBe(
        vi.mocked(createRoundEditing).mock.results[0].value,
      );
    });

    it("遷移の実装は、開始と完了・削除・一覧へ戻るの手続きで同じものを共有する", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createRouterPageNavigation).toHaveBeenCalledTimes(1);
      const start = vi.mocked(createRoundStart).mock.calls[0][0].pageNavigation;
      const leaving =
        vi.mocked(createRoundLeaving).mock.calls[0][0].pageNavigation;
      expect(leaving).toBe(start);
    });

    it("プリセットの書き込みは1度だけ生成し、削除の手続きと保存の手続きが同じものを使う", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createPresetCommands).toHaveBeenCalledTimes(1);
      const commands = vi.mocked(createPresetCommands).mock.results[0].value;
      expect(vi.mocked(createPresetDeletion).mock.calls[0][0].commands).toBe(
        commands,
      );
      expect(vi.mocked(createPresetSaving).mock.calls[0][0].commands).toBe(
        commands,
      );
    });

    it("保存の手続きは1度だけ生成し、サインインの読み取り、プリセットの書き込み、取得の部品を受け、再描画で作り直さない", () => {
      // Given
      const { rerender } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      rerender(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createPresetSaving).toHaveBeenCalledTimes(1);
      const deps = vi.mocked(createPresetSaving).mock.calls[0][0];
      expect(deps.signIn).toBe(
        vi.mocked(createRoundStart).mock.calls[0][0].signIn,
      );
      expect(deps.fetching).toBe(
        vi.mocked(createRoundFetching).mock.results[0].value,
      );
    });

    it("取得と開始と削除が、同じサインインの読み取りを共有する", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      const fetcher = vi.mocked(createContentFetcher).mock.calls[0][0].signIn;
      const start = vi.mocked(createRoundStart).mock.calls[0][0].signIn;
      const deletion = vi.mocked(createPresetDeletion).mock.calls[0][0].signIn;
      expect(start).toBe(fetcher);
      expect(deletion).toBe(fetcher);
    });

    it("取得と削除が、同じ保存済みを共有する", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      const fetching =
        vi.mocked(createRoundFetching).mock.calls[0][0].snapshots;
      const deletion =
        vi.mocked(createPresetDeletion).mock.calls[0][0].snapshots;
      expect(deletion).toBe(fetching);
    });

    it("画面の状態と開始の手続きが、同じIDの実装を受ける", () => {
      // Given
      const { rerender } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      rerender(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      const storeIds = vi.mocked(createRoundDetailStore).mock.calls[0][0].ids;
      const startIds = vi.mocked(createRoundStart).mock.calls[0][0].ids;
      expect(startIds).toBe(storeIds);
    });

    it("作成の画面の状態へ、生成した開始の手続きと削除の手続きを渡す", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      const deps = vi.mocked(createNewRoundStore).mock.calls[0][0];
      expect(deps.roundStart).toBe(
        vi.mocked(createRoundStart).mock.results[0].value,
      );
      expect(deps.presetDeletion).toBe(
        vi.mocked(createPresetDeletion).mock.results[0].value,
      );
    });

    it("画面の状態へ、生成した完了・削除・一覧へ戻る手続きと保存の手続きを渡す", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      const deps = vi.mocked(createRoundDetailStore).mock.calls[0][0];
      expect(deps.leaving).toBe(
        vi.mocked(createRoundLeaving).mock.results[0].value,
      );
      expect(deps.presetSaving).toBe(
        vi.mocked(createPresetSaving).mock.results[0].value,
      );
    });

    it("削除の手続きは1度だけ生成し、記録のハブとIDの実装を受け、一覧の窓口と完了・削除・一覧へ戻る手続きが同じものを使う", () => {
      // Given
      const { rerender } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      rerender(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createRoundDeletion).toHaveBeenCalledTimes(1);
      const deps = vi.mocked(createRoundDeletion).mock.calls[0][0];
      const deletion = vi.mocked(createRoundDeletion).mock.results[0].value;
      expect(deps.hub).toBe(
        vi.mocked(createRoundRecordHub).mock.results[0].value,
      );
      expect(deps.ids).toBe(
        vi.mocked(createBrowserUniqueIds).mock.results[0].value,
      );
      expect(vi.mocked(createRoundsListStore).mock.calls[0][0].deletion).toBe(
        deletion,
      );
      expect(vi.mocked(createRoundLeaving).mock.calls[0][0].deletion).toBe(
        deletion,
      );
    });

    it("一覧と詳細の窓口が、同じ記録のハブ、取り直しの依頼、取得、時計、接続を受ける", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createRoundsListStore).toHaveBeenCalledTimes(1);
      const list = vi.mocked(createRoundsListStore).mock.calls[0][0];
      const detail = vi.mocked(createRoundDetailStore).mock.calls[0][0];
      expect(list.hub).toBe(
        vi.mocked(createRoundRecordHub).mock.results[0].value,
      );
      expect(list.fetching).toBe(
        vi.mocked(createRoundFetching).mock.results[0].value,
      );
      expect(detail.hub).toBe(list.hub);
      expect(detail.requests).toBe(list.requests);
      expect(detail.fetching).toBe(list.fetching);
      expect(detail.clock).toBe(list.clock);
      expect(detail.connectivity).toBe(list.connectivity);
    });

    it("プリセットの書き込みは、他の問い合わせの実装と同じデータベースの約束から作る", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(vi.mocked(createPresetCommands).mock.calls[0][0]).toBe(
        vi.mocked(createRoundQueries).mock.calls[0][0],
      );
    });

    it("一覧の取得に使うサインインの読み取りが、記録の手続きと共有する認証の実装を使う", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      const { changes } = vi.mocked(createLocalIdentity).mock.calls[0][0];
      expect(createAuthSignInReader).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createAuthSignInReader).mock.calls[0][0]).toBe(changes);
    });

    it("画面の追記、再読み込みの前の保存の待ち、同期が、同じ記録のハブを使う", async () => {
      // Given
      let store: ReturnType<typeof useRoundDetailStore> | undefined;
      render(
        <RootClientEntry>
          <Appender onStore={(value) => (store = value)} />
        </RootClientEntry>,
      );
      storage.hold = true;
      const created = roundCreated();
      const records = vi.mocked(createOpSender).mock.calls[0][0].records;

      // When
      const appending = store?.round("round-1").append(created);
      await Promise.resolve();
      const outboxWhileSaving = records.outbox("round:round-1");
      let persisted = false;
      const waiting = vi
        .mocked(createUpdateActivation)
        .mock.calls[0][0].persistence.whenPersisted()
        .then(() => {
          persisted = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const persistedBeforeRelease = persisted;
      storage.release?.();
      await appending;
      await waiting;

      // Then
      expect(outboxWhileSaving.map((item) => item.eventId)).toEqual([
        created.eventId,
      ]);
      expect(persistedBeforeRelease).toBe(false);
      expect(persisted).toBe(true);
    });

    it("トークンの更新は、同期の再開として届き、識別情報の記録は変わらない", () => {
      // Given
      localStorage.setItem("aims:local-user-id", "user-1");
      render(<RootClientEntry>{null}</RootClientEntry>);
      const resume = vi.spyOn(lastSync(), "resume");

      // When
      act(() => supabase.emit("TOKEN_REFRESHED", { user: { id: "user-1" } }));

      // Then
      expect(resume).toHaveBeenCalledTimes(1);
      expect(createBrowserIdentityStore().read()).toBe("user-1");
    });

    it("事前描画(サーバー側の描画)で生成しても、ブラウザの購読や大域の名前に触れず、投げない", () => {
      // Given
      const addWindow = vi.spyOn(window, "addEventListener");
      const addDocument = vi.spyOn(document, "addEventListener");

      // When
      const html = renderToString(
        <RootClientEntry>
          <p>子要素</p>
        </RootClientEntry>,
      );

      // Then
      expect(html).toContain("子要素");
      expect(addWindow).not.toHaveBeenCalled();
      expect(addDocument).not.toHaveBeenCalled();
      expect(nav.router.push).not.toHaveBeenCalled();
      expect(nav.router.replace).not.toHaveBeenCalled();
    });
  });

  describe("アンマウント", () => {
    it("更新の切り替えの手続きの停止関数を呼ぶ", () => {
      // Given
      const { unmount } = render(<RootClientEntry>{null}</RootClientEntry>);
      const activation = vi.mocked(createUpdateActivation).mock.results[0]
        .value;
      const stop = vi.mocked(activation.start).mock.results[0].value;
      expect(stop).not.toHaveBeenCalled();

      // When
      unmount();

      // Then
      expect(stop).toHaveBeenCalledTimes(1);
    });

    it("認証状態の変化の購読を、識別情報の記録と同期の契機の2本とも解除する", () => {
      // Given
      const { unmount } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      unmount();

      // Then
      expect(supabase.unsubscribe).toHaveBeenCalledTimes(2);
    });

    it("通信の復帰、切断、見える状態の購読を解除し、解除した後の通知で同期を動かさない", () => {
      // Given
      const { unmount } = render(<RootClientEntry>{null}</RootClientEntry>);
      const sync = lastSync();
      const online = vi.spyOn(sync, "online");
      const offline = vi.spyOn(sync, "offline");
      const visible = vi.spyOn(sync, "visible");
      unmount();

      // When
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("offline"));
      document.dispatchEvent(new Event("visibilitychange"));

      // Then
      expect(online).not.toHaveBeenCalled();
      expect(offline).not.toHaveBeenCalled();
      expect(visible).not.toHaveBeenCalled();
    });

    it("解除した後にサインインやサインアウトが来ても、識別情報を記録も消去もしない", () => {
      // Given
      localStorage.setItem("aims:local-user-id", "user-1");
      const { unmount } = render(<RootClientEntry>{null}</RootClientEntry>);
      unmount();

      // When
      act(() => {
        supabase.emit("SIGNED_IN", { user: { id: "user-2" } });
        supabase.emit("SIGNED_OUT", null);
      });

      // Then
      expect(createBrowserIdentityStore().read()).toBe("user-1");
    });
  });
});
