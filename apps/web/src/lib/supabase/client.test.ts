import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client";

const db = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: db.createBrowserClient,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("createClient", () => {
  it("環境変数からSDKへ正しいURL/キーを渡す", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const client = { fake: "client" };
    db.createBrowserClient.mockReturnValue(client);

    const result = createClient();

    expect(db.createBrowserClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
    );
    expect(result).toBe(client);
  });

  it("URLが無い場合はエラーを投げる", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    expect(() => createClient()).toThrow(
      "Missing Supabase environment variables in client.",
    );
    expect(db.createBrowserClient).not.toHaveBeenCalled();
  });

  it("キーが無い場合はエラーを投げる", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    expect(() => createClient()).toThrow(
      "Missing Supabase environment variables in client.",
    );
  });
});
