import type { SupabaseClient } from "@supabase/supabase-js";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createStart } from "../application/start";
import { createAuthSignInCheck } from "../infrastructure/auth-sign-in-check";
import { StartButton } from "./start-button";

const sessionReader = { readSession: vi.fn() };

// 認証の読み手だけを偽にし、変換の実装と手続きは実物を通す。
function createStartWith(reader: Parameters<typeof createAuthSignInCheck>[0]) {
  return createStart({ signInCheck: createAuthSignInCheck(reader) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("StartButton", () => {
  // 行き先の判定の出力はリンクの行き先だけで観測できる。押して移ることはE2E(navigation.spec.ts)が確かめる。
  it("判定中は、開始リンクの行き先を/signupにし、判定済みの印(data-hydrated)を付けない", () => {
    // Given
    sessionReader.readSession.mockReturnValue(new Promise(() => {}));

    // When
    render(<StartButton start={createStartWith(sessionReader)} />);

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
    render(<StartButton start={createStartWith(sessionReader)} />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    await vi.waitFor(() => expect(link).toHaveAttribute("href", "/rounds"));
    expect(link).toHaveAttribute("data-hydrated", "true");
  });

  it("確認が通信の失敗で不明(unknown)になると、行き先を/roundsに替える", async () => {
    // Given
    sessionReader.readSession.mockResolvedValue({ status: "unknown" });

    // When
    render(<StartButton start={createStartWith(sessionReader)} />);

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
    render(<StartButton start={createStartWith(sessionReader)} />);

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
    render(<StartButton start={createStartWith(throwingReader)} />);

    // Then
    const link = screen.getByRole("link", { name: "開始" });
    await vi.waitFor(() =>
      expect(link).toHaveAttribute("data-hydrated", "true"),
    );
    expect(link).toHaveAttribute("href", "/rounds");
  });

  describe("サインインの状態の読み取りは、画面を開いたときの1回だけである", () => {
    beforeEach(() => {
      sessionReader.readSession.mockResolvedValue({
        status: "authenticated",
        userId: "user-1",
      });
    });

    it("描画して判定が済むと、読み取りは1回である", async () => {
      // Given
      // When
      render(<StartButton start={createStartWith(sessionReader)} />);

      // Then
      await vi.waitFor(() =>
        expect(screen.getByRole("link", { name: "開始" })).toHaveAttribute(
          "data-hydrated",
          "true",
        ),
      );
      expect(sessionReader.readSession).toHaveBeenCalledTimes(1);
    });

    it("判定済みの開始リンクを押しても、読み直さない", async () => {
      // Given
      render(<StartButton start={createStartWith(sessionReader)} />);
      const link = screen.getByRole("link", { name: "開始" });
      await vi.waitFor(() =>
        expect(link).toHaveAttribute("data-hydrated", "true"),
      );

      // When
      // jsdomは画面遷移を再現しないため、既定の動作を止めて押す。
      link.addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(link);

      // Then
      expect(sessionReader.readSession).toHaveBeenCalledTimes(1);
    });

    it("同じ手続きで再描画しても、読み直さない", async () => {
      // Given
      const start = createStartWith(sessionReader);
      const { rerender } = render(<StartButton start={start} />);
      await vi.waitFor(() =>
        expect(screen.getByRole("link", { name: "開始" })).toHaveAttribute(
          "data-hydrated",
          "true",
        ),
      );

      // When
      rerender(<StartButton start={start} />);

      // Then
      expect(sessionReader.readSession).toHaveBeenCalledTimes(1);
    });
  });
});
