import type { SetAllCookies } from "@supabase/ssr";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateSession } from "./session";
import {
  cacheHeadersOf,
  forwardedHeadersOf,
  LIBRARY_CACHE_HEADERS,
  NO_CACHE_HEADERS,
  removedCookie,
  requestCookiesOf,
  responseCookiesOf,
  SESSION_MAX_AGE_SECONDS,
  writtenCookie,
} from "./session-test-helpers";

const db = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: db.createServerClient,
}));

type ClaimsResult = {
  data: { claims: { sub: string } } | null;
  error: Error | null;
};

// getClaimsの結果。claimsがあれば認証済み、無い(null)・エラーは未認証。
function mockClaims(result: ClaimsResult) {
  db.createServerClient.mockImplementation(() => ({
    auth: { getClaims: vi.fn().mockResolvedValue(result) },
  }));
}

// 実際のSDKは、セッションの更新と削除のとき、getClaimsの内部からcookies.setAllを呼ぶ(1回の要求で複数回ありうる)。
// ここではその呼び出しをgetClaimsのモック内で再現し、全ての呼び出しの後に結果(返すか、投げるか)へ進む。
function mockSessionWrites(
  writes: Parameters<SetAllCookies>[0][],
  settle: () => Promise<ClaimsResult> = async () => signedInClaims,
) {
  db.createServerClient.mockImplementation((_url, _key, options) => ({
    auth: {
      getClaims: vi.fn().mockImplementation(async () => {
        for (const cookies of writes) {
          await options.cookies.setAll(cookies, { ...LIBRARY_CACHE_HEADERS });
        }
        return settle();
      }),
    },
  }));
}

const signedInClaims = { data: { claims: { sub: "user-1" } }, error: null };

const AUTH_COOKIE = "sb-example-auth-token";
const CHUNK_0 = `${AUTH_COOKIE}.0`;
const CHUNK_1 = `${AUTH_COOKIE}.1`;
const CHUNK_2 = `${AUTH_COOKIE}.2`;
const VERIFIER_COOKIE = `${AUTH_COOKIE}-code-verifier`;
const USER_COOKIE = `${AUTH_COOKIE}-user`;

const ROUND_URL = "https://app.example.com/rounds/1";
const SIGN_IN_URL = new URL("https://app.example.com/signin");

const NOW = new Date("2026-11-27T00:00:00.000Z");
const EXPIRES_AT = new Date(NOW.getTime() + SESSION_MAX_AGE_SECONDS * 1000);

// 分割されたセッションと、無関係のcookie・ヘッダーを持つ要求。
function requestWithSession(chunks: string[] = [CHUNK_0, CHUNK_1]) {
  const cookies = chunks.map((name, index) => `${name}=old-${index}`);
  return new NextRequest(ROUND_URL, {
    headers: {
      cookie: [...cookies, "theme=dark%20mode"].join("; "),
      "cache-control": "max-age=7",
      "x-request-id": "request-1",
    },
  });
}

// 分割されたセッションの全ての分割を書き換える、1回の呼び出し。
const REFRESHED = [
  [
    writtenCookie(CHUNK_0, "base64-new-0"),
    writtenCookie(CHUNK_1, "base64-new-1"),
  ],
];

// 更新の後にセッションなしが返る場合の2回の呼び出し。2回目は、1回目の検証用cookieを含まない。
const REFRESHED_THEN_REMOVED = [
  [
    removedCookie(VERIFIER_COOKIE),
    writtenCookie(CHUNK_0, "base64-new-0"),
    writtenCookie(CHUNK_1, "base64-new-1"),
  ],
  [removedCookie(CHUNK_0), removedCookie(CHUNK_1), removedCookie(USER_COOKIE)],
];

const REMOVED_COOKIE = { value: "", path: "/", sameSite: "lax", maxAge: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("updateSession", () => {
  it("環境変数のURLと鍵を、@supabase/ssrの接続へそのまま渡す", async () => {
    // Given
    mockClaims({ data: null, error: null });

    // When
    const request = new NextRequest("https://app.example.com/rounds");
    await updateSession(request);

    // Then
    const [url, key] = db.createServerClient.mock.calls[0];
    expect(url).toBe("https://example.supabase.co");
    expect(key).toBe("anon-key");
  });

  it.each([
    ["claimsがある", true, signedInClaims],
    ["claimsが無い", false, { data: null, error: null }],
    [
      "署名が不正などのエラー",
      false,
      { data: null, error: new Error("invalid JWT") },
    ],
  ])(
    "getClaimsの結果が%sときは、サインインしているか(%s)を返し、行き先が無ければリダイレクトしない応答を返す",
    async (_name, expected, result) => {
      // Given
      mockClaims(result);

      // When
      const request = new NextRequest(ROUND_URL);
      const { signedIn, respond } = await updateSession(request);
      const response = respond(null);

      // Then
      expect(signedIn).toBe(expected);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("cookiesのgetAllはrequestのcookieをそのまま返す", async () => {
    // Given
    mockClaims(signedInClaims);

    // When
    const request = new NextRequest(ROUND_URL, {
      headers: { cookie: "existing=1" },
    });
    await updateSession(request);

    // Then
    const [, , options] = db.createServerClient.mock.calls[0];
    expect(options.cookies.getAll()).toEqual([
      { name: "existing", value: "1" },
    ]);
  });

  describe("セッションのcookieを書き換える", () => {
    it("セッションを更新すると、非転送の応答と後続の要求へ、全ての分割cookieを渡す", async () => {
      // Given
      vi.useFakeTimers({ toFake: ["Date"], now: NOW });
      mockSessionWrites(REFRESHED);

      // When
      const request = requestWithSession();
      const { respond } = await updateSession(request);
      const response = respond(null);

      // Then
      const attributes = {
        path: "/",
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE_SECONDS,
        expires: EXPIRES_AT,
      };
      expect(responseCookiesOf(response)).toMatchObject({
        [CHUNK_0]: { value: "base64-new-0", ...attributes },
        [CHUNK_1]: { value: "base64-new-1", ...attributes },
      });
      expect(response.headers.getSetCookie()).toHaveLength(2);
      const forwarded = forwardedHeadersOf(response);
      expect(requestCookiesOf(forwarded)).toEqual({
        [CHUNK_0]: "base64-new-0",
        [CHUNK_1]: "base64-new-1",
        theme: "dark mode",
      });
      expect(forwarded.get("x-request-id")).toBe("request-1");
      expect(forwarded.get("cache-control")).toBe("max-age=7");
      expect(response.headers.get("location")).toBeNull();
    });

    it("セッションを更新すると、転送の応答にも、非転送と同じcookieとキャッシュ禁止を載せる", async () => {
      // Given
      vi.useFakeTimers({ toFake: ["Date"], now: NOW });
      mockSessionWrites(REFRESHED);

      // When
      const passed = (await updateSession(requestWithSession())).respond(null);
      const redirected = (await updateSession(requestWithSession())).respond(
        SIGN_IN_URL,
      );

      // Then
      expect(redirected.status).toBe(307);
      expect(redirected.headers.get("location")).toBe(SIGN_IN_URL.href);
      expect(Object.keys(responseCookiesOf(redirected))).toHaveLength(2);
      expect(responseCookiesOf(redirected)).toEqual(responseCookiesOf(passed));
      expect(cacheHeadersOf(passed)).toEqual(LIBRARY_CACHE_HEADERS);
      expect(cacheHeadersOf(redirected)).toEqual(LIBRARY_CACHE_HEADERS);
    });

    it("複数回の書き換えでも、非転送の応答と後続の要求は、先のcookieを失わず、同名は最後の値になる", async () => {
      // Given
      mockSessionWrites(REFRESHED_THEN_REMOVED);

      // When
      const { respond } = await updateSession(requestWithSession());
      const response = respond(null);

      // Then
      expect(responseCookiesOf(response)).toMatchObject({
        [VERIFIER_COOKIE]: REMOVED_COOKIE,
        [CHUNK_0]: REMOVED_COOKIE,
        [CHUNK_1]: REMOVED_COOKIE,
        [USER_COOKIE]: REMOVED_COOKIE,
      });
      expect(response.headers.getSetCookie()).toHaveLength(4);
      expect(cacheHeadersOf(response)).toEqual(LIBRARY_CACHE_HEADERS);
      expect(requestCookiesOf(forwardedHeadersOf(response))).toEqual({
        [VERIFIER_COOKIE]: "",
        [CHUNK_0]: "",
        [CHUNK_1]: "",
        [USER_COOKIE]: "",
        theme: "dark mode",
      });
    });

    it("複数回の書き換えでも、転送の応答は、先のcookieを失わず、同名は最後の値になる", async () => {
      // Given
      mockSessionWrites(REFRESHED_THEN_REMOVED);

      // When
      const { respond } = await updateSession(requestWithSession());
      const response = respond(SIGN_IN_URL);

      // Then
      expect(response.status).toBe(307);
      expect(responseCookiesOf(response)).toMatchObject({
        [VERIFIER_COOKIE]: REMOVED_COOKIE,
        [CHUNK_0]: REMOVED_COOKIE,
        [CHUNK_1]: REMOVED_COOKIE,
        [USER_COOKIE]: REMOVED_COOKIE,
      });
      expect(response.headers.getSetCookie()).toHaveLength(4);
      expect(cacheHeadersOf(response)).toEqual(LIBRARY_CACHE_HEADERS);
    });

    it("不要な分割を削除する非転送では、後続に古い値を渡さず、ブラウザへ削除を伝える", async () => {
      // Given
      mockSessionWrites([[...REFRESHED[0], removedCookie(CHUNK_2)]]);

      // When
      const request = requestWithSession([CHUNK_0, CHUNK_1, CHUNK_2]);
      const { respond } = await updateSession(request);
      const response = respond(null);

      // Then
      expect(requestCookiesOf(forwardedHeadersOf(response))).toEqual({
        [CHUNK_0]: "base64-new-0",
        [CHUNK_1]: "base64-new-1",
        [CHUNK_2]: "",
        theme: "dark mode",
      });
      expect(responseCookiesOf(response)[CHUNK_2]).toMatchObject(
        REMOVED_COOKIE,
      );
      expect(cacheHeadersOf(response)).toEqual(LIBRARY_CACHE_HEADERS);
    });

    it("不要な分割を削除する転送でも、ブラウザへ削除を伝える", async () => {
      // Given
      mockSessionWrites([[...REFRESHED[0], removedCookie(CHUNK_2)]]);

      // When
      const request = requestWithSession([CHUNK_0, CHUNK_1, CHUNK_2]);
      const { respond } = await updateSession(request);
      const response = respond(SIGN_IN_URL);

      // Then
      expect(responseCookiesOf(response)).toMatchObject({
        [CHUNK_0]: { value: "base64-new-0" },
        [CHUNK_1]: { value: "base64-new-1" },
        [CHUNK_2]: REMOVED_COOKIE,
      });
      expect(cacheHeadersOf(response)).toEqual(LIBRARY_CACHE_HEADERS);
    });

    it("セッションを削除する非転送では、後続に古い値を渡さず、ブラウザへ全ての分割の削除を伝える", async () => {
      // Given
      mockSessionWrites([[removedCookie(CHUNK_0), removedCookie(CHUNK_1)]]);

      // When
      const { respond } = await updateSession(requestWithSession());
      const response = respond(null);

      // Then
      expect(responseCookiesOf(response)).toMatchObject({
        [CHUNK_0]: REMOVED_COOKIE,
        [CHUNK_1]: REMOVED_COOKIE,
      });
      expect(cacheHeadersOf(response)).toEqual(LIBRARY_CACHE_HEADERS);
      expect(requestCookiesOf(forwardedHeadersOf(response))).toEqual({
        [CHUNK_0]: "",
        [CHUNK_1]: "",
        theme: "dark mode",
      });
    });

    it("セッションを削除する転送でも、ブラウザへ全ての分割の削除を伝える", async () => {
      // Given
      mockSessionWrites([[removedCookie(CHUNK_0), removedCookie(CHUNK_1)]]);

      // When
      const { respond } = await updateSession(requestWithSession());
      const response = respond(SIGN_IN_URL);

      // Then
      expect(response.status).toBe(307);
      expect(responseCookiesOf(response)).toMatchObject({
        [CHUNK_0]: REMOVED_COOKIE,
        [CHUNK_1]: REMOVED_COOKIE,
      });
      expect(cacheHeadersOf(response)).toEqual(LIBRARY_CACHE_HEADERS);
    });
  });

  describe("セッションのcookieを書き換えない", () => {
    it("非転送では、cookieとキャッシュ指定を追加せず、要求を変えずに後続へ渡す", async () => {
      // Given
      mockClaims(signedInClaims);

      // When
      const request = requestWithSession();
      const original = [...request.headers];
      const { respond } = await updateSession(request);
      const response = respond(null);

      // Then
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(cacheHeadersOf(response)).toEqual(NO_CACHE_HEADERS);
      expect([...request.headers]).toEqual(original);
      expect([...forwardedHeadersOf(response)]).toEqual(original);
    });

    it("転送では、cookieとキャッシュ指定を追加せず、要求を変えない", async () => {
      // Given
      mockClaims(signedInClaims);

      // When
      const request = requestWithSession();
      const original = [...request.headers];
      const { respond } = await updateSession(request);
      const response = respond(SIGN_IN_URL);

      // Then
      expect(response.status).toBe(307);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(cacheHeadersOf(response)).toEqual(NO_CACHE_HEADERS);
      expect([...request.headers]).toEqual(original);
    });
  });

  describe("認証の判定に失敗する", () => {
    it("getClaimsが投げたときも、投げ直さず、未認証として返す", async () => {
      // Given
      db.createServerClient.mockImplementation(() => ({
        auth: {
          getClaims: vi.fn().mockRejectedValue(new Error("crypto failed")),
        },
      }));

      // When
      const request = new NextRequest(ROUND_URL);
      const result = updateSession(request);

      // Then
      await expect(result).resolves.toMatchObject({ signedIn: false });
    });

    const returnsError = async () => ({
      data: null,
      error: new Error("invalid JWT"),
    });
    const throwsError = async (): Promise<ClaimsResult> => {
      throw new Error("crypto failed");
    };

    it.each([
      ["エラーを返す", "非転送", returnsError, null],
      ["エラーを返す", "転送", returnsError, SIGN_IN_URL],
      ["投げる", "非転送", throwsError, null],
      ["投げる", "転送", throwsError, SIGN_IN_URL],
    ])(
      "書き換えの後にgetClaimsが%sときは、未認証とし、%sの応答に書き換えを残す",
      async (_failure, _kind, settle, redirectTo) => {
        // Given
        mockSessionWrites(
          [[removedCookie(CHUNK_0), removedCookie(CHUNK_1)]],
          settle,
        );

        // When
        const { signedIn, respond } = await updateSession(requestWithSession());
        const response = respond(redirectTo);

        // Then
        expect(signedIn).toBe(false);
        expect(responseCookiesOf(response)).toMatchObject({
          [CHUNK_0]: REMOVED_COOKIE,
          [CHUNK_1]: REMOVED_COOKIE,
        });
        expect(cacheHeadersOf(response)).toEqual(LIBRARY_CACHE_HEADERS);
      },
    );

    it.each([
      ["非転送", null],
      ["転送", SIGN_IN_URL],
    ])(
      "書き換えの指示がない通信の失敗では、未認証とし、%sの応答でcookieを独自に削除しない",
      async (_kind, redirectTo) => {
        // Given
        mockClaims({
          data: null,
          error: new AuthRetryableFetchError("fetch failed", 0),
        });

        // When
        const request = requestWithSession();
        const original = [...request.headers];
        const { signedIn, respond } = await updateSession(request);
        const response = respond(redirectTo);

        // Then
        expect(signedIn).toBe(false);
        expect([...request.headers]).toEqual(original);
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(cacheHeadersOf(response)).toEqual(NO_CACHE_HEADERS);
      },
    );
  });
});
