import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { LocalIdentityProvider } from "./local-identity-provider";

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

beforeEach(() => {
  vi.clearAllMocks();
  supabase.listeners.length = 0;
  localStorage.clear();
});

describe("LocalIdentityProvider", () => {
  describe("マウント", () => {
    it("何も表示しない", () => {
      // Given
      const element = <LocalIdentityProvider />;

      // When
      const { container } = render(element);

      // Then
      expect(container).toBeEmptyDOMElement();
    });

    it("サインインしたユーザーを端末ローカルの識別ユーザーとして記録する", () => {
      // Given
      render(<LocalIdentityProvider />);

      // When
      supabase.emit("SIGNED_IN", { user: { id: "user-1" } });

      // Then
      expect(createBrowserIdentityStore().read()).toBe("user-1");
    });

    it("サインアウトすると、記録を消す", () => {
      // Given
      render(<LocalIdentityProvider />);
      supabase.emit("SIGNED_IN", { user: { id: "user-1" } });

      // When
      supabase.emit("SIGNED_OUT", null);

      // Then
      expect(createBrowserIdentityStore().read()).toBeNull();
    });

    it("復元されたセッション(INITIAL_SESSION)でも記録し、セッションが無いときは既存の記録を消さない", () => {
      // Given
      render(<LocalIdentityProvider />);
      supabase.emit("INITIAL_SESSION", { user: { id: "user-1" } });

      // When
      supabase.emit("INITIAL_SESSION", null);

      // Then
      expect(createBrowserIdentityStore().read()).toBe("user-1");
    });
  });

  describe("アンマウント", () => {
    it("認証状態の変化の購読を解除する", () => {
      // Given
      const { unmount } = render(<LocalIdentityProvider />);

      // When
      unmount();

      // Then
      expect(supabase.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("解除した後にサインインやサインアウトが来ても、識別情報を記録も消去もしない", () => {
      // Given
      localStorage.setItem("aims:local-user-id", "user-1");
      const { unmount } = render(<LocalIdentityProvider />);
      unmount();

      // When
      supabase.emit("SIGNED_IN", { user: { id: "user-2" } });
      supabase.emit("SIGNED_OUT", null);

      // Then
      expect(createBrowserIdentityStore().read()).toBe("user-1");
    });
  });
});
