import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartButton } from "./start-button";

const supabase = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: supabase.getSession } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("StartButton", () => {
  it("判定中は/signupへの開始リンクを表示し、data-hydratedは付けない", () => {
    // Given
    supabase.getSession.mockReturnValue(new Promise(() => {}));

    // When
    render(<StartButton />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    expect(link).toHaveAttribute("href", "/signup");
    expect(link).not.toHaveAttribute("data-hydrated");
  });

  it("認証済みなら/roundsへ替え、判定後にdata-hydratedを付ける", async () => {
    // Given
    supabase.getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });

    // When
    render(<StartButton />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    await vi.waitFor(() => expect(link).toHaveAttribute("href", "/rounds"));
    expect(link).toHaveAttribute("data-hydrated", "true");
  });

  it("通信失敗（unknown）なら/roundsへ替える", async () => {
    // Given
    supabase.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    // When
    render(<StartButton />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    await vi.waitFor(() => expect(link).toHaveAttribute("href", "/rounds"));
  });

  it("未認証なら/signupのまま、判定後にdata-hydratedを付ける", async () => {
    // Given
    supabase.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    // When
    render(<StartButton />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    await vi.waitFor(() =>
      expect(link).toHaveAttribute("data-hydrated", "true"),
    );
    expect(link).toHaveAttribute("href", "/signup");
  });

  it("判定に失敗しても/signupのまま、data-hydratedを付ける", async () => {
    // Given
    supabase.getSession.mockRejectedValue(new Error("failed"));

    // When
    render(<StartButton />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    await vi.waitFor(() =>
      expect(link).toHaveAttribute("data-hydrated", "true"),
    );
    expect(link).toHaveAttribute("href", "/signup");
  });
});
