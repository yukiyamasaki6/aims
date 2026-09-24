import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

// Supabaseクライアントは外部サービスとの境界のため、getUserの結果を制御できるスタブで模す。
const db = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: db.getUser } }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("proxy", () => {
  describe("対象パス", () => {
    it.each([
      "/",
      "/signin",
      "/signup",
      "/reset-password",
      "/rounds",
      "/rounds/1",
      "/rounds/1/edit",
    ])("%sで実行する", (url) => {
      // Given
      // When
      const matched = unstable_doesMiddlewareMatch({ config, url });

      // Then
      expect(matched).toBe(true);
    });

    it.each([
      "/offline",
      "/sw.js",
      "/manifest.webmanifest",
      "/_next/static/chunks/main.js",
      "/signin/extra",
      "/roundsx",
    ])("%sでは実行しない", (url) => {
      // Given
      // When
      const matched = unstable_doesMiddlewareMatch({ config, url });

      // Then
      expect(matched).toBe(false);
    });
  });

  describe("リクエストを受け取る", () => {
    it("セッションの更新結果をレスポンスとして返す", async () => {
      // Given
      db.getUser.mockResolvedValue({ data: { user: null } });
      const request = new NextRequest("https://app.example.com/rounds/1");

      // When
      const response = await proxy(request);

      // Then
      expect(response.headers.get("location")).toBe(
        "https://app.example.com/signin",
      );
    });
  });
});
