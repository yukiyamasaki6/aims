import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateSession } from "./session";

const db = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: db.createServerClient,
}));

// getClaimsの結果。claimsがあれば認証済み、無い(null)・エラーは未認証。
function mockClaims(result: {
  data: { claims: { sub: string } } | null;
  error: Error | null;
}) {
  db.createServerClient.mockImplementation(() => ({
    auth: { getClaims: vi.fn().mockResolvedValue(result) },
  }));
}

const signedInClaims = { data: { claims: { sub: "user-1" } }, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
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
    ["claimsがある", signedInClaims, true],
    ["claimsが無い", { data: null, error: null }, false],
    [
      "署名が不正などのエラー",
      { data: null, error: new Error("invalid JWT") },
      false,
    ],
  ])(
    "getClaimsの結果が%sときは、サインインしているか(%s)を返し、リダイレクトしない応答を返す",
    async (_name, result, expected) => {
      // Given
      mockClaims(result);

      // When
      const request = new NextRequest("https://app.example.com/rounds/1");
      const { signedIn, response } = await updateSession(request);

      // Then
      expect(signedIn).toBe(expected);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("getClaimsが投げたときも、投げ直さず、未認証として返す", async () => {
    // Given
    db.createServerClient.mockImplementation(() => ({
      auth: {
        getClaims: vi.fn().mockRejectedValue(new Error("crypto failed")),
      },
    }));

    // When
    const request = new NextRequest("https://app.example.com/rounds/1");
    const result = updateSession(request);

    // Then
    await expect(result).resolves.toMatchObject({ signedIn: false });
  });

  it("cookiesのgetAllはrequestのcookieをそのまま返す", async () => {
    // Given
    mockClaims(signedInClaims);

    // When
    const request = new NextRequest("https://app.example.com/rounds/1", {
      headers: { cookie: "existing=1" },
    });
    await updateSession(request);

    // Then
    const [, , options] = db.createServerClient.mock.calls[0];
    expect(options.cookies.getAll()).toEqual(request.cookies.getAll());
  });

  it("cookiesのsetAllで書き込まれた値を、応答だけに反映する", async () => {
    // Given
    // 実際のSDKはセッションリフレッシュ時にgetClaims内部からcookies.setAllを
    // 呼び出す。ここではその呼び出しをgetClaimsのモック内で再現する。
    db.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getClaims: vi.fn().mockImplementation(async () => {
          options.cookies.setAll([
            { name: "sb-token", value: "new-value", options: { path: "/" } },
          ]);
          return signedInClaims;
        }),
      },
    }));

    // When
    const request = new NextRequest("https://app.example.com/rounds/1");
    const { response } = await updateSession(request);

    // Then
    expect(response.cookies.get("sb-token")?.value).toBe("new-value");
    expect(request.cookies.get("sb-token")).toBeUndefined();
  });
});
