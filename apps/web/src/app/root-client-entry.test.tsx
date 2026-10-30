import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalIdentity } from "@/features/auth/application/local-identity";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createOpSender } from "@/features/round-sync/application/op-sender";
import { createRoundSync } from "@/features/round-sync/application/round-sync";
import { createSyncTriggers } from "@/features/round-sync/application/sync-triggers";
import { createRoundRecordHub } from "@/features/rounds/application/round-record-hub";
import { createRoundsStore } from "@/features/rounds/application/rounds-store";
import { createAuthSignInReader } from "@/features/rounds/infrastructure/auth-sign-in-reader";
import { createBrowserEventIds } from "@/features/rounds/infrastructure/browser-event-ids";
import { roundCreated } from "@/features/rounds/round-op-test-helpers";
import { useRoundsStore } from "@/features/rounds/ui/rounds-context";
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

// 再読み込みを担う別の入口は別のテストで確かめるため、受け取ったpropsを記録する代役に差し替える。
const activator = vi.hoisted(() => ({
  props: [] as { whenPersisted: () => Promise<void> }[],
}));
vi.mock("./sw-update-activator", () => ({
  SwUpdateActivator: (props: { whenPersisted: () => Promise<void> }) => {
    activator.props.push(props);
    return null;
  },
}));

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
  "@/features/rounds/application/rounds-store",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/rounds-store")
      >();
    return { ...actual, createRoundsStore: vi.fn(actual.createRoundsStore) };
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
  "@/features/rounds/infrastructure/browser-event-ids",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/infrastructure/browser-event-ids")
      >();
    return {
      createBrowserEventIds: vi.fn(actual.createBrowserEventIds),
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
  onStore: (store: ReturnType<typeof useRoundsStore>) => void;
}) {
  onStore(useRoundsStore());
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

    it("画面の遷移で待機中の新SWを有効にするSwUpdateActivatorを含め、保存の待ちを渡す", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(activator.props).toHaveLength(1);
      expect(activator.props[0].whenPersisted).toBeTypeOf("function");
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

    it("操作のイベントIDの払い出しは1度だけ生成し、ラウンドの状態と変更の方法へ渡して、再描画で作り直さない", () => {
      // Given
      const { rerender } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      rerender(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(createBrowserEventIds).toHaveBeenCalledTimes(1);
      expect(createRoundsStore).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createRoundsStore).mock.calls[0][0].ids).toBe(
        vi.mocked(createBrowserEventIds).mock.results[0].value,
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
      let store: ReturnType<typeof useRoundsStore> | undefined;
      render(
        <RootClientEntry>
          <Appender onStore={(value) => (store = value)} />
        </RootClientEntry>,
      );
      storage.hold = true;
      const created = roundCreated();
      const records = vi.mocked(createOpSender).mock.calls[0][0].records;

      // When
      const appending = store?.append("round-1", created);
      await Promise.resolve();
      const outboxWhileSaving = records.outbox("round:round-1");
      let persisted = false;
      const waiting = activator.props[0].whenPersisted().then(() => {
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
      const channel = vi.fn();
      vi.stubGlobal("BroadcastChannel", channel);
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
      expect(channel).not.toHaveBeenCalled();
      expect(addWindow).not.toHaveBeenCalled();
      expect(addDocument).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe("アンマウント", () => {
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
