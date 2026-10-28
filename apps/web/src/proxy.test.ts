import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RESET_PASSWORD_PATH,
  redirectFor,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
} from "@/features/auth/domain/routes";
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
      "/",
      "/offline",
      "/sw.js",
      "/manifest.webmanifest",
      "/_next/static/chunks/main.js",
      "/signin/extra",
      "/roundsx",
      "/__shell/rounds",
      "/__shell/rounds/new",
      "/__shell/rounds/_",
    ])("%sでは実行しない", (url) => {
      // Given
      // When
      const matched = unstable_doesMiddlewareMatch({ config, url });

      // Then
      expect(matched).toBe(false);
    });
  });

  // matcherはNext.jsの静的な設定で経路を文字列で再掲するため、経路の規則(redirectFor)と食い違わないことを、規則が動く経路で確かめる。
  describe("対象パスと経路の規則の一致", () => {
    const probes = [
      SIGN_IN_PATH,
      SIGN_UP_PATH,
      RESET_PASSWORD_PATH,
      "/rounds",
      "/rounds/1",
      "/rounds/1/edit",
      "/rounds/new",
      "/",
      "/offline",
      "/roundsx",
      "/signin/extra",
      "/__shell/rounds",
    ];

    it.each(probes)(
      "%sは、規則がリダイレクトする状態があるときだけ、実行の対象になる",
      (pathname) => {
        // Given
        const redirects = [false, true].some(
          (signedIn) =>
            redirectFor({
              signedIn,
              pathname,
              search: "",
              isServerAction: false,
            }) !== null,
        );

        // When
        const matched = unstable_doesMiddlewareMatch({ config, url: pathname });

        // Then
        expect(matched).toBe(redirects);
      },
    );
  });

  describe("リクエストを受け取る", () => {
    it("セッションの更新結果をレスポンスとして返す", async () => {
      // Given
      db.getUser.mockResolvedValue({ data: { user: null } });

      // When
      const request = new NextRequest("https://app.example.com/rounds/1");
      const response = await proxy(request);

      // Then
      expect(response.headers.get("location")).toBe(
        "https://app.example.com/signin?returnTo=%2Frounds%2F1",
      );
    });
  });
});
