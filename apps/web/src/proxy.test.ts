import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RESET_PASSWORD_PATH,
  redirectFor,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
} from "@/features/auth/domain/auth-routes";
import {
  OFFLINE_PATH,
  shellUrlOf,
} from "@/features/offline-pwa/domain/offline-routes";
import {
  ROUND_FRAME_PATHS,
  ROUNDS_PATH,
} from "@/features/rounds/domain/round-routes";
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
      "/rounds/1/edit",
      ROUNDS_PATH,
      `${ROUNDS_PATH}/1`,
    ])("%sで実行する", (url) => {
      // Given
      // When
      const matched = unstable_doesMiddlewareMatch({ config, url });

      // Then
      expect(matched).toBe(true);
    });

    it.each([
      "/",
      OFFLINE_PATH,
      "/sw.js",
      "/manifest.webmanifest",
      "/_next/static/chunks/main.js",
      "/signin/extra",
      "/roundsx",
      ...ROUND_FRAME_PATHS.map(shellUrlOf),
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
      "/rounds/1/edit",
      "/rounds/new",
      ROUNDS_PATH,
      `${ROUNDS_PATH}/1`,
      "/",
      OFFLINE_PATH,
      "/roundsx",
      "/signin/extra",
      ...ROUND_FRAME_PATHS.map(shellUrlOf),
    ];

    it.each(probes)(
      "%sは、規則がリダイレクトする状態があるときだけ、実行の対象になる",
      (pathname) => {
        // Given
        const redirects = [false, true].some(
          (signedIn) =>
            redirectFor(
              {
                signedIn,
                pathname,
                search: "",
              },
              ROUNDS_PATH,
            ) !== null,
        );

        // When
        const matched = unstable_doesMiddlewareMatch({ config, url: pathname });

        // Then
        expect(matched).toBe(redirects);
      },
    );
  });

  describe("リクエストを受け取る", () => {
    it("未認証で一覧の経路を開くと、その経路を遷移元に付けてサインインへリダイレクトする", async () => {
      // Given
      db.getUser.mockResolvedValue({ data: { user: null } });

      // When
      const request = new NextRequest(`https://app.example.com${ROUNDS_PATH}`);
      const response = await proxy(request);

      // Then
      expect(response.headers.get("location")).toBe(
        "https://app.example.com/signin?returnTo=%2Frounds",
      );
    });

    it("認証済みで一覧の経路を開くと、リダイレクトせず、セッションの更新の応答を返す", async () => {
      // Given
      db.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

      // When
      const request = new NextRequest("https://app.example.com/rounds/1");
      const response = await proxy(request);

      // Then
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });
  });
});
