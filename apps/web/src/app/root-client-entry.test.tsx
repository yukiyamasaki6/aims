import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityReader, SessionReader } from "@/features/auth";
import { createLocalIdentity } from "@/features/auth/application/local-identity";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
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
      },
    })),
    emit(event: string, session: { user: { id: string } } | null) {
      for (const listener of listeners) listener(event, session);
    },
  };
});
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: supabase.createBrowserClient,
}));

// 常駐の2つの部品は別のテストで確かめるため、受け取ったpropsを記録する代役に差し替える。
const received = vi.hoisted(() => ({
  opSync: [] as {
    identityReader: IdentityReader;
    sessionReader: SessionReader;
  }[],
  refresher: [] as { sessionReader: SessionReader }[],
}));
vi.mock("./op-sync-provider", () => ({
  OpSyncProvider: (props: (typeof received.opSync)[number]) => {
    received.opSync.push(props);
    return null;
  },
}));
vi.mock("./round-base-refresher", () => ({
  RoundBaseRefresher: (props: (typeof received.refresher)[number]) => {
    received.refresher.push(props);
    return null;
  },
}));

// 記録の手続きは実物を呼び通し、渡された引数だけを観測する。
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

beforeEach(() => {
  vi.clearAllMocks();
  supabase.listeners.length = 0;
  received.opSync.length = 0;
  received.refresher.length = 0;
  localStorage.clear();
});

describe("RootClientEntry", () => {
  describe("マウント", () => {
    it("何も表示しない", () => {
      // Given
      const element = <RootClientEntry />;

      // When
      const { container } = render(element);

      // Then
      expect(container).toBeEmptyDOMElement();
    });

    it("サインインしたユーザーを端末ローカルの識別ユーザーとして記録する", () => {
      // Given
      render(<RootClientEntry />);

      // When
      supabase.emit("SIGNED_IN", { user: { id: "user-1" } });

      // Then
      expect(createBrowserIdentityStore().read()).toBe("user-1");
    });

    it("サインアウトすると、記録を消す", () => {
      // Given
      render(<RootClientEntry />);
      supabase.emit("SIGNED_IN", { user: { id: "user-1" } });

      // When
      supabase.emit("SIGNED_OUT", null);

      // Then
      expect(createBrowserIdentityStore().read()).toBeNull();
    });

    it("復元されたセッション(INITIAL_SESSION)でも記録し、セッションが無いときは既存の記録を消さない", () => {
      // Given
      render(<RootClientEntry />);
      supabase.emit("INITIAL_SESSION", { user: { id: "user-1" } });

      // When
      supabase.emit("INITIAL_SESSION", null);

      // Then
      expect(createBrowserIdentityStore().read()).toBe("user-1");
    });
  });

  describe("常駐の部品への受け渡し", () => {
    it("記録の手続きと2つの常駐の部品が、認証の実装と識別情報の保存先をそれぞれ1つ共有する", () => {
      // Given
      const element = <RootClientEntry />;

      // When
      render(element);

      // Then
      const { changes, writer } =
        vi.mocked(createLocalIdentity).mock.calls[0][0];
      expect(received.opSync[0].sessionReader).toBe(changes);
      expect(received.refresher[0].sessionReader).toBe(changes);
      expect(received.opSync[0].identityReader).toBe(writer);
    });

    it("再描画しても、同じ実体を渡し続け、記録の手続きを作り直さない", () => {
      // Given
      const { rerender } = render(<RootClientEntry />);
      const first = received.opSync[0];

      // When
      rerender(<RootClientEntry />);

      // Then
      const last = received.opSync.at(-1);
      expect(last?.sessionReader).toBe(first.sessionReader);
      expect(last?.identityReader).toBe(first.identityReader);
      expect(received.refresher.at(-1)?.sessionReader).toBe(
        first.sessionReader,
      );
      expect(createLocalIdentity).toHaveBeenCalledTimes(1);
    });

    it("記録した利用者を、常駐の部品へ渡した識別情報の読み手から読める", () => {
      // Given
      render(<RootClientEntry />);

      // When
      supabase.emit("SIGNED_IN", { user: { id: "user-1" } });

      // Then
      expect(received.opSync[0].identityReader.read()).toBe("user-1");
    });
  });

  describe("アンマウント", () => {
    it("認証状態の変化の購読を解除する", () => {
      // Given
      const { unmount } = render(<RootClientEntry />);

      // When
      unmount();

      // Then
      expect(supabase.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("解除した後にサインインやサインアウトが来ても、識別情報を記録も消去もしない", () => {
      // Given
      localStorage.setItem("aims:local-user-id", "user-1");
      const { unmount } = render(<RootClientEntry />);
      unmount();

      // When
      supabase.emit("SIGNED_IN", { user: { id: "user-2" } });
      supabase.emit("SIGNED_OUT", null);

      // Then
      expect(createBrowserIdentityStore().read()).toBe("user-1");
    });
  });
});
