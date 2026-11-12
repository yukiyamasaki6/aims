import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redirectFor } from "@/features/auth/domain/auth-routes";
import {
  FRAME_PATHS,
  HOME_PATH,
  OFFLINE_PATH,
  RESET_PASSWORD_PATH,
  ROUNDS_PATH,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  SW_PATH,
  shellUrlOf,
} from "@/routes";
import { config, proxy } from "./proxy";

// Supabaseクライアントは外部サービスとの境界のため、getClaimsの結果を制御できるスタブで模す。
const db = vi.hoisted(() => ({ getClaims: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: db.getClaims } }),
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
      "/settings",
      "/settings/1",
    ])("%sで実行する", (url) => {
      // Given
      // When
      const matched = unstable_doesMiddlewareMatch({ config, url });

      // Then
      expect(matched).toBe(true);
    });

    it.each([
      HOME_PATH,
      OFFLINE_PATH,
      SW_PATH,
      "/manifest.webmanifest",
      "/_next/static/chunks/main.js",
      "/signin/extra",
      "/roundsx",
      "/settingsx",
      ...FRAME_PATHS.map(shellUrlOf),
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
      HOME_PATH,
      OFFLINE_PATH,
      SW_PATH,
      "/manifest.webmanifest",
      "/roundsx",
      "/signin/extra",
      "/settings",
      "/settings/1",
      "/settingsx",
      ...FRAME_PATHS.map(shellUrlOf),
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
    it("未認証で一覧の経路を開くと、その経路を遷移元に付けてサインインへリダイレクトする", async () => {
      // Given
      db.getClaims.mockResolvedValue({ data: null, error: null });

      // When
      const request = new NextRequest(`https://app.example.com${ROUNDS_PATH}`);
      const response = await proxy(request);

      // Then
      expect(response.headers.get("location")).toBe(
        "https://app.example.com/signin?returnTo=%2Frounds",
      );
    });

    it("未認証で設定の経路を開くと、その経路を遷移元に付けてサインインへリダイレクトする", async () => {
      // Given
      db.getClaims.mockResolvedValue({ data: null, error: null });

      // When
      const request = new NextRequest("https://app.example.com/settings");
      const response = await proxy(request);

      // Then
      expect(response.headers.get("location")).toBe(
        "https://app.example.com/signin?returnTo=%2Fsettings",
      );
    });

    it("認証済みで遷移元付きのサインインを開くと、遷移元へリダイレクトする", async () => {
      // Given
      db.getClaims.mockResolvedValue({
        data: { claims: { sub: "user-1" } },
        error: null,
      });

      // When
      const request = new NextRequest(
        "https://app.example.com/signin?returnTo=%2Frounds%2Fx%3Fa%3D1",
      );
      const response = await proxy(request);

      // Then
      expect(response.headers.get("location")).toBe(
        "https://app.example.com/rounds/x?a=1",
      );
    });

    it("認証済みで一覧の経路を開くと、リダイレクトせず、セッションの更新の応答を返す", async () => {
      // Given
      db.getClaims.mockResolvedValue({
        data: { claims: { sub: "user-1" } },
        error: null,
      });

      // When
      const request = new NextRequest("https://app.example.com/rounds/1");
      const response = await proxy(request);

      // Then
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });
  });
});
