import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "./page";

// 認証SDKの接続を隔離する。手続きと変換の実装と認証の実装は実物のまま通す。
vi.mock("@/lib/supabase/infrastructure/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  }),
}));

// 紹介画面の部品は別のテストで確かめるため、受け取ったpropsを記録する代役に差し替えられるようにする。
const received = vi.hoisted(() => ({
  replace: false,
  props: undefined as
    | { start?: { pendingHref?: string; decideHref?: unknown } }
    | undefined,
}));
vi.mock("@/features/navigation/ui/intro-screen", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/navigation/ui/intro-screen")
  >("@/features/navigation/ui/intro-screen");
  return {
    IntroScreen: (props: Parameters<typeof actual.IntroScreen>[0]) => {
      received.props = props;
      return received.replace ? (
        <a href="/signup">開始</a>
      ) : (
        actual.IntroScreen(props)
      );
    },
  };
});

describe("Home", () => {
  it("紹介画面を描き、開始ボタンを表示する", async () => {
    // Given
    received.replace = false;

    // When
    render(<Home />);

    // Then
    expect(screen.getByRole("heading", { name: "AIMS" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開始" })).toBeInTheDocument();
    // 開始ボタンの判定が済むまで待つ(描画後の状態更新を描画の外に残さない)。
    await vi.waitFor(() =>
      expect(screen.getByRole("link", { name: "開始" })).toHaveAttribute(
        "data-hydrated",
        "true",
      ),
    );
  });

  it("開始の手続きを、紹介画面へ渡す", () => {
    // Given
    received.replace = true;

    // When
    render(<Home />);

    // Then
    expect(received.props?.start?.pendingHref).toBe("/signup");
    expect(received.props?.start?.decideHref).toBeTypeOf("function");
  });
});
