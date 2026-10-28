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

const noRedirect = () => null;

describe("updateSession", () => {
  it("Supabaseの環境変数が無い場合はエラーを投げる", async () => {
    // Given
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";

    // When
    const request = new NextRequest("https://app.example.com/rounds");
    const result = updateSession(request, noRedirect);

    // Then
    await expect(result).rejects.toThrow(
      "Missing Supabase environment variables in middleware.",
    );
  });

  it("規則が行き先を返したら、その行き先へリダイレクトする", async () => {
    // Given
    mockUser(null);
    const rule = vi.fn(() => "/signin?returnTo=%2Frounds%2F1");

    // When
    const request = new NextRequest("https://app.example.com/rounds/1");
    const res = await updateSession(request, rule);

    // Then
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/signin?returnTo=%2Frounds%2F1",
    );
  });

  it("規則がnullを返したら、リダイレクトしない", async () => {
    // Given
    mockUser({ id: "user-1" });

    // When
    const request = new NextRequest("https://app.example.com/rounds/1");
    const res = await updateSession(request, noRedirect);

    // Then
    expect(res.headers.get("location")).toBeNull();
  });

  it.each([
    ["未認証", null, false],
    ["認証済み", { id: "user-1" }, true],
  ])(
    "規則へ、%sかを示すsignedInと、パスとクエリを渡す",
    async (_name, user, signedIn) => {
      // Given
      mockUser(user);
      const rule = vi.fn(noRedirect);

      // When
      const request = new NextRequest("https://app.example.com/rounds/1?a=1");
      await updateSession(request, rule);

      // Then
      expect(rule).toHaveBeenCalledExactlyOnceWith({
        signedIn,
        pathname: "/rounds/1",
        search: "?a=1",
        isServerAction: false,
      });
    },
  );

  it("Server Action呼び出し(next-actionヘッダー付き)かどうかを規則へ渡す", async () => {
    // Given
    mockUser(null);
    const rule = vi.fn(noRedirect);

    // When
    const request = new NextRequest("https://app.example.com/rounds/1", {
      headers: { "next-action": "abc123" },
    });
    await updateSession(request, rule);

    // Then
    expect(rule).toHaveBeenCalledWith(
      expect.objectContaining({ isServerAction: true }),
    );
  });

  it("cookiesのgetAllはrequestのcookieをそのまま返す", async () => {
    // Given
    mockUser({ id: "user-1" });

    // When
    const request = new NextRequest("https://app.example.com/rounds/1", {
      headers: { cookie: "existing=1" },
    });
    await updateSession(request, noRedirect);

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
    const res = await updateSession(request, noRedirect);

    // Then
    expect(request.cookies.get("sb-token")?.value).toBe("new-value");
    expect(res.cookies.get("sb-token")?.value).toBe("new-value");
  });
});
