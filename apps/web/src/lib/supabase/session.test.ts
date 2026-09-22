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
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    const request = new NextRequest("https://app.example.com/rounds");

    await expect(updateSession(request)).rejects.toThrow(
      "Missing Supabase environment variables in middleware.",
    );
  });

  it("未認証で/rounds配下にアクセスすると/signinへリダイレクトする", async () => {
    mockUser(null);
    const request = new NextRequest("https://app.example.com/rounds/1");

    const res = await updateSession(request);

    expect(res.headers.get("location")).toBe("https://app.example.com/signin");
  });

  it("未認証でもServer Action呼び出しは/rounds配下でリダイレクトしない", async () => {
    mockUser(null);
    const request = new NextRequest("https://app.example.com/rounds/1", {
      headers: { "next-action": "abc123" },
    });

    const res = await updateSession(request);

    expect(res.headers.get("location")).toBeNull();
  });

  it("未認証で/rounds以外のパスはリダイレクトしない", async () => {
    mockUser(null);
    const request = new NextRequest("https://app.example.com/offline");

    const res = await updateSession(request);

    expect(res.headers.get("location")).toBeNull();
  });

  it("認証済みで/signinにアクセスすると/roundsへリダイレクトする", async () => {
    mockUser({ id: "user-1" });
    const request = new NextRequest("https://app.example.com/signin");

    const res = await updateSession(request);

    expect(res.headers.get("location")).toBe("https://app.example.com/rounds");
  });

  it("認証済みでもServer Action呼び出しはサインイン専用パスでリダイレクトしない", async () => {
    mockUser({ id: "user-1" });
    const request = new NextRequest("https://app.example.com/signin", {
      headers: { "next-action": "abc123" },
    });

    const res = await updateSession(request);

    expect(res.headers.get("location")).toBeNull();
  });

  it("認証済みでサインイン専用パス以外はリダイレクトしない", async () => {
    mockUser({ id: "user-1" });
    const request = new NextRequest("https://app.example.com/rounds/1");

    const res = await updateSession(request);

    expect(res.headers.get("location")).toBeNull();
  });

  it("cookiesのgetAllはrequestのcookieをそのまま返す", async () => {
    mockUser({ id: "user-1" });
    const request = new NextRequest("https://app.example.com/rounds/1", {
      headers: { cookie: "existing=1" },
    });

    await updateSession(request);

    const [, , options] = db.createServerClient.mock.calls[0];
    expect(options.cookies.getAll()).toEqual(request.cookies.getAll());
  });

  it("cookiesのsetAllで書き込まれた値をrequestとレスポンス双方に反映する", async () => {
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
    const request = new NextRequest("https://app.example.com/rounds/1");

    const res = await updateSession(request);

    expect(request.cookies.get("sb-token")?.value).toBe("new-value");
    expect(res.cookies.get("sb-token")?.value).toBe("new-value");
  });
});
