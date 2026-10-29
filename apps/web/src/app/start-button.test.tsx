import type { SupabaseClient } from "@supabase/supabase-js";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { StartButton } from "./start-button";

const sessionReader = { readSession: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("StartButton", () => {
  // 行き先の判定の出力はリンクの行き先だけで観測できる。押して移ることはE2E(navigation.spec.ts)が確かめる。
  it("判定中は、開始リンクの行き先を/signupにし、判定済みの印(data-hydrated)を付けない", () => {
    // Given
    sessionReader.readSession.mockReturnValue(new Promise(() => {}));

    // When
    render(<StartButton sessionReader={sessionReader} />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    expect(link).toHaveAttribute("href", "/signup");
    expect(link).not.toHaveAttribute("data-hydrated");
  });

  it("認証済みと判定すると、行き先を/roundsに替え、判定済みの印を付ける", async () => {
    // Given
    sessionReader.readSession.mockResolvedValue({
      status: "authenticated",
      userId: "user-1",
    });

    // When
    render(<StartButton sessionReader={sessionReader} />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    await vi.waitFor(() => expect(link).toHaveAttribute("href", "/rounds"));
    expect(link).toHaveAttribute("data-hydrated", "true");
  });

  it("確認が通信の失敗で不明(unknown)になると、行き先を/roundsに替える", async () => {
    // Given
    sessionReader.readSession.mockResolvedValue({ status: "unknown" });

    // When
    render(<StartButton sessionReader={sessionReader} />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    await vi.waitFor(() => expect(link).toHaveAttribute("href", "/rounds"));
  });

  it("未認証と判定すると、行き先を/signupのままにし、判定済みの印を付ける", async () => {
    // Given
    sessionReader.readSession.mockResolvedValue({
      status: "unauthenticated",
    });

    // When
    render(<StartButton sessionReader={sessionReader} />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    await vi.waitFor(() =>
      expect(link).toHaveAttribute("data-hydrated", "true"),
    );
    expect(link).toHaveAttribute("href", "/signup");
  });

  it("サインインの状態を確かめられないとき(確認の処理が投げた場合を含む)は、未認証ならサーバーの保護がサインインへ送る一覧を行き先にし、判定済みの印を付ける", async () => {
    // Given
    const throwingReader = createSupabaseAuth(
      () =>
        ({
          auth: {
            getSession: async () => {
              throw new Error("failed");
            },
          },
        }) as unknown as SupabaseClient,
    );

    // When
    render(<StartButton sessionReader={throwingReader} />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    await vi.waitFor(() =>
      expect(link).toHaveAttribute("data-hydrated", "true"),
    );
    expect(link).toHaveAttribute("href", "/rounds");
  });
});
