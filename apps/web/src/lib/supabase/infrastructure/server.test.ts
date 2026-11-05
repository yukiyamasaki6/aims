import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "./server";

const db = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: db.createClient,
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
