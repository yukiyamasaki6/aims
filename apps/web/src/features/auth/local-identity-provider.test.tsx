import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalIdentity } from "./local-identity";
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
    createClient: vi.fn(() => ({
      auth: {
        onAuthStateChange: (listener: (typeof listeners)[number]) => {
          listeners.push(listener);
          return { data: { subscription: { unsubscribe } } };
        },
      },
    })),
    emit(event: string, session: { user: { id: string } } | null) {
      for (const listener of listeners) listener(event, session);
    },
  };
});
vi.mock("@/lib/supabase/client", () => ({
  createClient: supabase.createClient,
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
      expect(getLocalIdentity()).toBe("user-1");
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
  });
});
