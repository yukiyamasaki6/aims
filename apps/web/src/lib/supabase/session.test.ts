import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateSession } from "./session";

const db = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: db.createServerClient,
}));

function mockUser(user: { id: string } | null) {
  db.createServerClient.mockImplementation(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

describe("updateSession", () => {
  it("Supabaseの環境変数が無い場合はエラーを投げる", async () => {
    // Given
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";

    // When
    const request = new NextRequest("https://app.example.com/rounds");
    const result = updateSession(request);

    // Then
    await expect(result).rejects.toThrow(
      "Missing Supabase environment variables in middleware.",
    );
  });

  it("未認証で/roundsにアクセスすると、遷移元を付けずに/signinへリダイレクトする", async () => {
    // Given
    mockUser(null);

    // When
    const request = new NextRequest("https://app.example.com/rounds");
    const res = await updateSession(request);

    // Then
    expect(res.headers.get("location")).toBe("https://app.example.com/signin");
  });

  it.each([
    ["/rounds/new", "%2Frounds%2Fnew"],
    [
      "/rounds/00000000-0000-0000-0000-000000000000?a=1",
      "%2Frounds%2F00000000-0000-0000-0000-000000000000%3Fa%3D1",
    ],
  ])(
    "未認証で%sにアクセスすると、遷移元付きの/signinへリダイレクトする",
    async (path, encoded) => {
      // Given
      mockUser(null);

      // When
      const request = new NextRequest(`https://app.example.com${path}`);
      const res = await updateSession(request);

      // Then
      expect(res.headers.get("location")).toBe(
        `https://app.example.com/signin?returnTo=${encoded}`,
      );
    },
  );

  it("未認証でもServer Action呼び出しは/rounds配下でリダイレクトしない", async () => {
    // Given
    mockUser(null);

    // When
    const request = new NextRequest("https://app.example.com/rounds/1", {
      headers: { "next-action": "abc123" },
    });
    const res = await updateSession(request);

    // Then
    expect(res.headers.get("location")).toBeNull();
  });

  it("未認証で/rounds以外のパスはリダイレクトしない", async () => {
    // Given
    mockUser(null);

    // When
    const request = new NextRequest("https://app.example.com/offline");
    const res = await updateSession(request);

    // Then
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/signin", "/signup", "/reset-password"])(
    "認証済みで%sにアクセスすると/roundsへリダイレクトする",
    async (path) => {
      // Given
      mockUser({ id: "user-1" });

      // When
      const request = new NextRequest(`https://app.example.com${path}`);
      const res = await updateSession(request);

      // Then
      expect(res.headers.get("location")).toBe(
        "https://app.example.com/rounds",
      );
    },
  );

  it("認証済みで有効な遷移元付きの/signinにアクセスすると、遷移元へリダイレクトする", async () => {
    // Given
    mockUser({ id: "user-1" });

    // When
    const request = new NextRequest(
      "https://app.example.com/signin?returnTo=%2Frounds%2Fnew%3Fa%3D1",
    );
    const res = await updateSession(request);

    // Then
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/rounds/new?a=1",
    );
  });

  it.each([
    ["外部URL", encodeURIComponent("https://evil.com")],
    ["//で始まる値", encodeURIComponent("//evil.com")],
    ["/signin", encodeURIComponent("/signin")],
    ["/rounds配下から抜けるドットセグメント", "%2Frounds%2F..%2Fsignin"],
  ])(
    "認証済みで不正な遷移元(%s)付きの/signinにアクセスすると、遷移元を引き継がず/roundsへリダイレクトする",
    async (_name, returnTo) => {
      // Given
      mockUser({ id: "user-1" });

      // When
      const request = new NextRequest(
        `https://app.example.com/signin?returnTo=${returnTo}`,
      );
      const res = await updateSession(request);

      // Then
      expect(res.headers.get("location")).toBe(
        "https://app.example.com/rounds",
      );
    },
  );

  it.each(["/signup", "/reset-password"])(
    "認証済みで有効な遷移元付きの%sにアクセスしても、遷移元を使わず/roundsへリダイレクトする",
    async (path) => {
      // Given
      mockUser({ id: "user-1" });

      // When
      const request = new NextRequest(
        `https://app.example.com${path}?returnTo=%2Frounds%2Fnew`,
      );
      const res = await updateSession(request);

      // Then
      expect(res.headers.get("location")).toBe(
        "https://app.example.com/rounds",
      );
    },
  );

  it("認証済みでもServer Action呼び出しはサインイン専用パスでリダイレクトしない", async () => {
    // Given
    mockUser({ id: "user-1" });

    // When
    const request = new NextRequest("https://app.example.com/signin", {
      headers: { "next-action": "abc123" },
    });
    const res = await updateSession(request);

    // Then
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/", "/rounds/1"])(
    "認証済みで未認証専用でない%sはリダイレクトしない",
    async (path) => {
      // Given
      mockUser({ id: "user-1" });

      // When
      const request = new NextRequest(`https://app.example.com${path}`);
      const res = await updateSession(request);

      // Then
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it("cookiesのgetAllはrequestのcookieをそのまま返す", async () => {
    // Given
    mockUser({ id: "user-1" });

    // When
    const request = new NextRequest("https://app.example.com/rounds/1", {
      headers: { cookie: "existing=1" },
    });
    await updateSession(request);

    // Then
    const [, , options] = db.createServerClient.mock.calls[0];
    expect(options.cookies.getAll()).toEqual(request.cookies.getAll());
  });

  it("cookiesのsetAllで書き込まれた値をrequestとレスポンス双方に反映する", async () => {
    // Given
    // 実際のSDKはセッションリフレッシュ時にgetUser内部からcookies.setAllを
    // 呼び出す。ここではその呼び出しをgetUserのモック内で再現する。
    db.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: vi.fn().mockImplementation(async () => {
          options.cookies.setAll([
            { name: "sb-token", value: "new-value", options: { path: "/" } },
          ]);
          return { data: { user: { id: "user-1" } } };
        }),
      },
    }));

    // When
    const request = new NextRequest("https://app.example.com/rounds/1");
    const res = await updateSession(request);

    // Then
    expect(request.cookies.get("sb-token")?.value).toBe("new-value");
    expect(res.cookies.get("sb-token")?.value).toBe("new-value");
  });
});
