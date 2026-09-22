import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./server";

const db = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: db.createServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: db.cookies,
}));

function mockCookieStore(
  overrides: Partial<{ set: (...args: unknown[]) => void }> = {},
) {
  const store = {
    getAll: vi.fn().mockReturnValue([{ name: "sb-token", value: "existing" }]),
    set: overrides.set ?? vi.fn(),
  };
  db.cookies.mockResolvedValue(store);
  return store;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("createClient", () => {
  it("環境変数からSDKへ正しいURL/キーを渡す", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    mockCookieStore();
    const client = { fake: "server-client" };
    db.createServerClient.mockReturnValue(client);

    const result = await createClient();

    expect(db.createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.objectContaining({ cookies: expect.anything() }),
    );
    expect(result).toBe(client);
  });

  it("URLが無い場合はエラーを投げる", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    await expect(createClient()).rejects.toThrow(
      "Missing Supabase environment variables in server client.",
    );
    expect(db.createServerClient).not.toHaveBeenCalled();
  });

  it("キーが無い場合はエラーを投げる", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    await expect(createClient()).rejects.toThrow(
      "Missing Supabase environment variables in server client.",
    );
  });

  it("cookiesのgetAllはcookieStoreの内容をそのまま返す", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const store = mockCookieStore();

    await createClient();
    const [, , options] = db.createServerClient.mock.calls[0];

    expect(options.cookies.getAll()).toEqual(store.getAll());
  });

  it("cookiesのsetAllはcookieStoreへ各cookieを書き込む", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const set = vi.fn();
    mockCookieStore({ set });

    await createClient();
    const [, , options] = db.createServerClient.mock.calls[0];
    options.cookies.setAll([
      { name: "sb-token", value: "new-value", options: { path: "/" } },
    ]);

    expect(set).toHaveBeenCalledWith("sb-token", "new-value", { path: "/" });
  });

  it("Server Componentからの呼び出し等でcookie書き込みが失敗してもエラーを投げず無視する", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const set = vi.fn().mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action");
    });
    mockCookieStore({ set });

    await createClient();
    const [, , options] = db.createServerClient.mock.calls[0];

    expect(() =>
      options.cookies.setAll([{ name: "sb-token", value: "v", options: {} }]),
    ).not.toThrow();
  });
});
