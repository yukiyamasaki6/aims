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
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
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
      { auth: { detectSessionInUrl: false } },
    );
    expect(result).toBe(client);
  });

  it("URLの`code`を自動で交換しない", async () => {
    // Given
    const actual =
      await vi.importActual<typeof import("@supabase/ssr")>("@supabase/ssr");
    db.createBrowserClient.mockImplementation(actual.createBrowserClient);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    // 検証子が無いと交換の前に失敗して要求が出ないため、別の接続でGoogleの開始を行い、検証子を保存先へ置く。
    await actual
      .createBrowserClient("https://example.supabase.co", "anon-key", {
        isSingleton: false,
      })
      .auth.signInWithOAuth({
        provider: "google",
        options: { skipBrowserRedirect: true },
      });
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/signin?code=x");

    // When
    await createClient().auth.getSession();

    // Then
    expect(fetchMock).not.toHaveBeenCalled();
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
