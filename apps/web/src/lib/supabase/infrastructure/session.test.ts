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
  it("環境変数のURLと鍵を、@supabase/ssrの接続へそのまま渡す", async () => {
    // Given
    mockUser(null);

    // When
    const request = new NextRequest("https://app.example.com/rounds");
    await updateSession(request);

    // Then
    const [url, key] = db.createServerClient.mock.calls[0];
    expect(url).toBe("https://example.supabase.co");
    expect(key).toBe("anon-key");
  });

  it.each([
    ["サインインしている", { id: "user-1" }],
    ["サインインしていない", null],
  ])(
    "%s場合は、その利用者(無ければnull)と、リダイレクトしない応答を返す",
    async (_name, user) => {
      // Given
      mockUser(user);

      // When
      const request = new NextRequest("https://app.example.com/rounds/1");
      const result = await updateSession(request);

      // Then
      expect(result.user).toEqual(user);
      expect(result.response.headers.get("location")).toBeNull();
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

  it("cookiesのsetAllで書き込まれた値を、応答だけに反映する", async () => {
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
    const { response } = await updateSession(request);

    // Then
    expect(response.cookies.get("sb-token")?.value).toBe("new-value");
    expect(request.cookies.get("sb-token")).toBeUndefined();
  });
});
