import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminClient, createServerClient } from "./server";

const db = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: db.createClient,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: db.createServerClient,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("createAdminClient", () => {
  it("環境変数からSDKへ正しいURL/シークレットキー・認証オプションを渡す", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret-key");
    const client = { fake: "admin-client" };
    db.createClient.mockReturnValue(client);

    // When
    const result = createAdminClient();

    // Then
    expect(db.createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "secret-key",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    expect(result).toBe(client);
  });

  it("URLが無い場合はエラーを投げる", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret-key");

    // When
    const create = () => createAdminClient();

    // Then
    expect(create).toThrow(
      "Missing Supabase environment variables in admin client.",
    );
    expect(db.createClient).not.toHaveBeenCalled();
  });

  it("シークレットキーが無い場合はエラーを投げる", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");

    // When
    const create = () => createAdminClient();

    // Then
    expect(create).toThrow(
      "Missing Supabase environment variables in admin client.",
    );
  });
});

describe("createServerClient", () => {
  type CookieOptions = {
    getAll(): unknown;
    setAll(cookies: { name: string; value: string; options: object }[]): void;
  };

  function cookieStore() {
    return {
      getAll: vi.fn(() => [
        { name: "sb-example-auth-token.0", value: "chunk-0" },
        { name: "sb-example-auth-token.1", value: "chunk-1" },
      ]),
      set: vi.fn(),
    };
  }

  // SDKへ渡した、cookieの読み書きの関数。
  function cookieOptions(): CookieOptions {
    return db.createServerClient.mock.calls[0]?.[2].cookies;
  }

  it("公開の環境変数のURLとキーで、要求の利用者の接続を作って返す", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const client = { fake: "server-client" };
    db.createServerClient.mockReturnValue(client);

    // When
    const result = createServerClient(cookieStore() as never);

    // Then
    expect(db.createServerClient).toHaveBeenCalledExactlyOnceWith(
      "https://example.supabase.co",
      "anon-key",
      { cookies: expect.any(Object) },
    );
    expect(result).toBe(client);
  });

  it("セッションは、要求のcookieの全てから読む", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const store = cookieStore();
    createServerClient(store as never);

    // When
    const read = cookieOptions().getAll();

    // Then
    expect(read).toEqual([
      { name: "sb-example-auth-token.0", value: "chunk-0" },
      { name: "sb-example-auth-token.1", value: "chunk-1" },
    ]);
    expect(store.getAll).toHaveBeenCalledOnce();
  });

  it("更新と削除を含む複数のcookieを、それぞれのoptionsのまま応答へ書く", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const store = cookieStore();
    createServerClient(store as never);
    const updated = { path: "/", sameSite: "lax", maxAge: 34560000 };
    const removed = { path: "/", sameSite: "lax", maxAge: 0 };

    // When
    cookieOptions().setAll([
      { name: "sb-example-auth-token.0", value: "new-chunk", options: updated },
      { name: "sb-example-auth-token.1", value: "", options: removed },
    ]);

    // Then
    expect(store.set.mock.calls).toEqual([
      ["sb-example-auth-token.0", "new-chunk", updated],
      ["sb-example-auth-token.1", "", removed],
    ]);
  });

  it.each([
    ["URL", "", "anon-key"],
    ["公開のキー", "https://example.supabase.co", ""],
  ])("%sが無い場合はエラーを投げ、接続を作らない", (_name, url, key) => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", key);

    // When
    const create = () => createServerClient(cookieStore() as never);

    // Then
    expect(create).toThrow(
      "Missing Supabase environment variables in server client.",
    );
    expect(db.createServerClient).not.toHaveBeenCalled();
  });
});
