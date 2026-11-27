import type { CookieMethodsServer, SetAllCookies } from "@supabase/ssr";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redirectFor } from "@/features/auth/domain/auth-routes";
import {
  cacheHeadersOf,
  forwardedHeadersOf,
  LIBRARY_CACHE_HEADERS,
  NO_CACHE_HEADERS,
  removedCookie,
  requestCookiesOf,
  responseCookiesOf,
  writtenCookie,
} from "@/lib/supabase/infrastructure/session-test-helpers";
import {
  FRAME_PATHS,
  HOME_PATH,
  OFFLINE_PATH,
  ROUNDS_PATH,
  SIGN_IN_PATH,
  SW_PATH,
  shellUrlOf,
} from "@/routes";
import { config, proxy } from "./proxy";

// Supabaseクライアントは外部サービスとの境界のため、getClaimsの結果を制御できるスタブで模す。
// getClaimsには接続に渡されたcookiesを渡し、実際のSDKと同じくgetClaimsの内部からsetAllを呼べるようにする。
const db = vi.hoisted(() => ({ getClaims: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    { cookies }: { cookies: CookieMethodsServer },
  ) => ({ auth: { getClaims: () => db.getClaims(cookies) } }),
}));

const signedInClaims = { data: { claims: { sub: "user-1" } }, error: null };
const noClaims = { data: null, error: null };

const CHUNK_0 = "sb-example-auth-token.0";
const CHUNK_1 = "sb-example-auth-token.1";
const REFRESHED = [
  writtenCookie(CHUNK_0, "base64-new-0"),
  writtenCookie(CHUNK_1, "base64-new-1"),
];
const REMOVED = [removedCookie(CHUNK_0), removedCookie(CHUNK_1)];

function mockSessionWrite(
  written: Parameters<SetAllCookies>[0],
  result: typeof signedInClaims | typeof noClaims,
) {
  db.getClaims.mockImplementation(async (cookies: CookieMethodsServer) => {
    await cookies.setAll?.(written, { ...LIBRARY_CACHE_HEADERS });
    return result;
  });
}

function requestWithSession(path: string) {
  return new NextRequest(`https://app.example.com${path}`, {
    headers: { cookie: `${CHUNK_0}=old-0; ${CHUNK_1}=old-1` },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("proxy", () => {
  describe("対象パス", () => {
    it.each(["/signin", "/rounds/1/edit", ROUNDS_PATH, `${ROUNDS_PATH}/1`])(
      "%sで実行する",
      (url) => {
        // Given
        // When
        const matched = unstable_doesMiddlewareMatch({ config, url });

        // Then
        expect(matched).toBe(true);
      },
    );

    it.each([
      HOME_PATH,
      OFFLINE_PATH,
      SW_PATH,
      "/manifest.webmanifest",
      "/_next/static/chunks/main.js",
      "/signin/extra",
      "/signup",
      "/roundsx",
      "/settings",
      "/settings/1",
      "/settings/delete-account",
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
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://app.example.com/signin?returnTo=%2Frounds",
      );
    });

    it.each([true, false])(
      "認証済み=%sで遷移元付きの/signupを開いても、廃止された経路としてリダイレクトしない",
      async (signedIn) => {
        // Given
        db.getClaims.mockResolvedValue({
          data: signedIn ? { claims: { sub: "user-1" } } : null,
          error: null,
        });

        // When
        const request = new NextRequest(
          "https://app.example.com/signup?returnTo=%2Frounds#settings",
        );
        const response = await proxy(request);

        // Then
        expect(response.headers.get("location")).toBeNull();
      },
    );

    it.each(["/settings", "/settings/1", "/settings/delete-account"])(
      "未認証で%sを開いても、保護の範囲の外のためリダイレクトしない",
      async (path) => {
        // Given
        db.getClaims.mockResolvedValue({ data: null, error: null });

        // When
        const request = new NextRequest(`https://app.example.com${path}`);
        const response = await proxy(request);

        // Then
        expect(response.headers.get("location")).toBeNull();
      },
    );

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
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://app.example.com/rounds/x?a=1",
      );
    });

    it.each([SIGN_IN_PATH])(
      "認証済みで遷移元のない%sを開くと、ホームへリダイレクトする",
      async (path) => {
        // Given
        db.getClaims.mockResolvedValue({
          data: { claims: { sub: "user-1" } },
          error: null,
        });

        // When
        const request = new NextRequest(`https://app.example.com${path}`);
        const response = await proxy(request);

        // Then
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe(
          `https://app.example.com${ROUNDS_PATH}`,
        );
      },
    );

    it("認証済みで一覧の経路を開くと、リダイレクトせず、要求を後続へ渡す応答を返す", async () => {
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

  describe("セッションのcookieを書き換える", () => {
    it.each([
      [
        "遷移元のある",
        "/signin?returnTo=%2Frounds%2Fx%3Fa%3D1",
        "/rounds/x?a=1",
      ],
      ["遷移元のない", SIGN_IN_PATH, ROUNDS_PATH],
    ])(
      "更新の後に認証済みで%sサインインを開くと、更新したcookieとキャッシュ禁止を持つ307でリダイレクトする",
      async (_name, path, destination) => {
        // Given
        mockSessionWrite(REFRESHED, signedInClaims);

        // When
        const response = await proxy(requestWithSession(path));

        // Then
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe(
          `https://app.example.com${destination}`,
        );
        expect(responseCookiesOf(response)).toMatchObject({
          [CHUNK_0]: { value: "base64-new-0" },
          [CHUNK_1]: { value: "base64-new-1" },
        });
        expect(cacheHeadersOf(response)).toEqual(LIBRARY_CACHE_HEADERS);
      },
    );

    it("削除の後に未認証でクエリ付きの保護の範囲を開くと、cookieの削除とキャッシュ禁止を持つ307でサインインへリダイレクトする", async () => {
      // Given
      mockSessionWrite(REMOVED, noClaims);

      // When
      const response = await proxy(requestWithSession("/rounds/1?a=1"));

      // Then
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://app.example.com/signin?returnTo=%2Frounds%2F1%3Fa%3D1",
      );
      expect(responseCookiesOf(response)).toMatchObject({
        [CHUNK_0]: { value: "", maxAge: 0 },
        [CHUNK_1]: { value: "", maxAge: 0 },
      });
      expect(cacheHeadersOf(response)).toEqual(LIBRARY_CACHE_HEADERS);
    });

    it.each([
      [
        "更新の後に認証済みで一覧の経路",
        `${ROUNDS_PATH}/1`,
        REFRESHED,
        signedInClaims,
        ["base64-new-0", "base64-new-1"],
      ],
      [
        "削除の後に未認証でサインイン",
        SIGN_IN_PATH,
        REMOVED,
        noClaims,
        ["", ""],
      ],
    ])(
      "%sを開くと、リダイレクトせず、書き換えたcookieをブラウザと後続の要求へ渡す",
      async (_name, path, written, result, [first, second]) => {
        // Given
        mockSessionWrite(written, result);

        // When
        const response = await proxy(requestWithSession(path));

        // Then
        expect(response.headers.get("location")).toBeNull();
        expect(responseCookiesOf(response)).toMatchObject({
          [CHUNK_0]: { value: first },
          [CHUNK_1]: { value: second },
        });
        expect(cacheHeadersOf(response)).toEqual(LIBRARY_CACHE_HEADERS);
        expect(requestCookiesOf(forwardedHeadersOf(response))).toEqual({
          [CHUNK_0]: first,
          [CHUNK_1]: second,
        });
      },
    );
  });

  describe("セッションのcookieを書き換えない", () => {
    it.each([
      [true, SIGN_IN_PATH, `https://app.example.com${ROUNDS_PATH}`],
      [false, ROUNDS_PATH, "https://app.example.com/signin?returnTo=%2Frounds"],
      [true, ROUNDS_PATH, null],
      [false, SIGN_IN_PATH, null],
    ])(
      "認証済み=%sで%sを開くと、経路の規則に従い(行き先: %s)、cookieとキャッシュ指定を追加しない",
      async (signedIn, path, location) => {
        // Given
        db.getClaims.mockResolvedValue(signedIn ? signedInClaims : noClaims);

        // When
        const response = await proxy(requestWithSession(path));

        // Then
        expect(response.headers.get("location")).toBe(location);
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(cacheHeadersOf(response)).toEqual(NO_CACHE_HEADERS);
      },
    );
  });
});
