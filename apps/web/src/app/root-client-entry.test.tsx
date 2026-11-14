import { act, render, screen } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import {
  createUpdateActivation,
  type UpdateActivation,
} from "@/features/offline-pwa/application/update-activation";
import { createOpSender } from "@/features/rounds/application/op-sender";
import { createRoundEditing } from "@/features/rounds/application/round-editing";
import { SHORT_WAIT_MS } from "@/features/rounds/domain/fetch-wait";
import { roundCreated } from "@/features/rounds/domain/round-op-test-helpers";
import { outboxOf } from "@/features/rounds/domain/round-record";
import { useRoundWindow } from "@/features/rounds/ui/rounds-context";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  type FakeViewport,
  installFakeViewport,
} from "@/lib/viewport/fake-viewport-test-helpers";
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

vi.mock("@/features/rounds/application/op-sender", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/features/rounds/application/op-sender")
    >();
  return { createOpSender: vi.fn(actual.createOpSender) };
});

// 画面の追記が使う記録のハブを取り出すため、実物を通して呼び出しを覚える。
vi.mock(
  "@/features/rounds/application/round-editing",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/rounds/application/round-editing")
      >();
    return { createRoundEditing: vi.fn(actual.createRoundEditing) };
  },
);

// jsdomにmatchMediaが無いため、入口の表示領域の補償が読む名前を、タブ(補償しない)の偽物で差す。
let viewport: FakeViewport;

beforeEach(() => {
  vi.clearAllMocks();
  viewport = installFakeViewport();
  supabase.listeners.length = 0;
  activator.props.length = 0;
  storage.hold = false;
  storage.release = null;
  localStorage.clear();
});

afterEach(() => {
  viewport.restore();
  vi.restoreAllMocks();
});

// 子の画面が、窓口を受け取る。
function Appender({
  onWindow,
}: {
  onWindow: (roundWindow: ReturnType<typeof useRoundWindow>) => void;
}) {
  onWindow(useRoundWindow());
  return <p>子要素</p>;
}

describe("RootClientEntry", () => {
  describe("マウント", () => {
    it("子要素を描く", () => {
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
    });

    it("スタンドアロンでは、表示領域の高さを根の枠の変数に書く(条件の組合せはuse-app-heightのテストが確かめる)", () => {
      // Given
      viewport.restore();
      viewport = installFakeViewport({
        standalone: true,
        virtualKeyboard: true,
        visualViewport: { height: 640, scale: 1 },
      });

      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      expect(
        document.documentElement.style.getPropertyValue("--app-height"),
      ).toBe("640px");
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

    it("更新の切り替えの手続きは、期限に短い待ちの上限(SHORT_WAIT_MS)と、アプリの時計、記録のハブの保存の待ちを受ける(手続きは差し替えのため配線の値で確かめ、期限の効きはupdate-activationのテストが確かめる)", () => {
      // Given
      // When
      render(<RootClientEntry>{null}</RootClientEntry>);

      // Then
      const deps = vi.mocked(createUpdateActivation).mock.calls[0][0];
      expect(deps.deadlineMs).toBe(SHORT_WAIT_MS);
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
  });

  describe("文言", () => {
    it("包んだ子の部品が、useTranslationsで文言の一覧の本文を表示する", () => {
      // Given
      function Label() {
        return <p>{useTranslations("shared")("confirmDelete")}</p>;
      }

      // When
      render(
        <RootClientEntry>
          <Label />
        </RootClientEntry>,
      );

      // Then
      expect(
        screen.getByText(translatorFor("shared")("confirmDelete")),
      ).toBeInTheDocument();
    });

    it("存在しないキーを参照しても、画面にキー名が出ない", () => {
      // Given
      vi.spyOn(console, "error").mockImplementation(() => {});
      function Missing() {
        const t = useTranslations("shared") as unknown as (
          key: string,
        ) => string;
        return <p data-testid="missing">{t("noSuchKey")}</p>;
      }

      // When
      render(
        <RootClientEntry>
          <Missing />
        </RootClientEntry>,
      );

      // Then
      expect(screen.getByTestId("missing")).toBeEmptyDOMElement();
      expect(document.body).not.toHaveTextContent("noSuchKey");
    });
  });

  describe("組み立て", () => {
    it("画面の追記、再読み込みの前の保存の待ち、同期が、同じ記録のハブを使う", async () => {
      // Given
      let roundWindow: ReturnType<typeof useRoundWindow> | undefined;
      render(
        <RootClientEntry>
          <Appender onWindow={(value) => (roundWindow = value)} />
        </RootClientEntry>,
      );
      storage.hold = true;
      const created = roundCreated();
      const { hub } = vi.mocked(createRoundEditing).mock.calls[0][0];
      const sendingHub = vi.mocked(createOpSender).mock.calls[0][0].hub;

      // When
      const unwatch = roundWindow?.watchLocalList(() => {});
      const appending = hub.append("round:round-1", created);
      await Promise.resolve();
      const outboxWhileSaving = outboxOf(sendingHub.record("round:round-1"));
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
      const listed = roundWindow?.localList()?.inProgress.length;
      unwatch?.();

      // Then
      expect(listed).toBe(1);
      expect(outboxWhileSaving.map((item) => item.eventId)).toEqual([
        created.eventId,
      ]);
      expect(persistedBeforeRelease).toBe(false);
      expect(persisted).toBe(true);
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

  describe("表示領域の診断", () => {
    const DiagnosticsKey = "aims:viewport-diagnostics";

    function badge() {
      return screen.queryByTestId("viewport-diagnostics-badge");
    }

    it("保存が有効なら、子要素の外側でバッジを表示する(子の画面の種類に依らない)", () => {
      // Given
      localStorage.setItem(DiagnosticsKey, "1");

      // When
      render(
        <RootClientEntry>
          <p>子要素</p>
        </RootClientEntry>,
      );

      // Then
      expect(badge()).toBeInTheDocument();
      expect(badge()?.parentElement).toBe(document.body);
      expect(screen.getByText("子要素")).toBeInTheDocument();
    });

    it("保存が無ければ、バッジを表示しない", () => {
      // Given
      // When
      render(
        <RootClientEntry>
          <p>子要素</p>
        </RootClientEntry>,
      );

      // Then
      expect(badge()).toBeNull();
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

    it("識別情報の記録の認証状態の購読を解除する。同期の契機の購読は解除しない", () => {
      // Given
      const { unmount } = render(<RootClientEntry>{null}</RootClientEntry>);

      // When
      unmount();

      // Then
      expect(supabase.unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
