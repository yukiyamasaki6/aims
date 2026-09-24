import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeftPanel } from "./left-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// リクエストのcookieはNext.jsの実行環境が提供するため境界としてモックする。
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

// Supabaseクライアントは外部サービスとの境界のため、getUserの結果を制御できるスタブで模す。
const db = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: db.getUser } }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("LeftPanel", () => {
  it("サインイン済みのユーザーがいる場合はサインアウトボタンを表示する", async () => {
    // Given
    db.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    // When
    render(await LeftPanel());

    // Then
    expect(
      screen.getByRole("button", { name: "サインアウト" }),
    ).toBeInTheDocument();
  });

  it("ユーザーがいない場合はサインアウトボタンを表示しない", async () => {
    // Given
    db.getUser.mockResolvedValue({ data: { user: null } });

    // When
    render(await LeftPanel());

    // Then
    expect(
      screen.queryByRole("button", { name: "サインアウト" }),
    ).not.toBeInTheDocument();
  });
});
