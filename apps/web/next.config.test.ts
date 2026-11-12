import { afterEach, describe, expect, it, vi } from "vitest";

async function rewrites(supabaseUrl: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  const { default: nextConfig } = await import("./next.config");
  const result = await nextConfig.rewrites?.();
  if (!result || Array.isArray(result)) throw new Error("rewritesが不正です。");
  return result;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config rewrites", () => {
  it("枠の配布用URLを、proxy.tsより前に実ルートへ向ける", async () => {
    // Given
    // When
    const { beforeFiles } = await rewrites("https://example.supabase.co");

    // Then
    expect(beforeFiles).toEqual([
      { source: "/__shell/rounds", destination: "/rounds" },
      {
        source: "/__shell/rounds/history",
        destination: "/rounds/history",
      },
      { source: "/__shell/rounds/new", destination: "/rounds/new" },
      { source: "/__shell/rounds/_", destination: "/rounds/_" },
      { source: "/__shell/settings", destination: "/settings" },
    ]);
  });

  it("/rounds/<ID>を静的ファイルの解決後に/rounds/_の枠へ向ける", async () => {
    // Given
    // When
    const { afterFiles } = await rewrites("https://example.supabase.co");

    // Then
    expect(afterFiles).toEqual([
      { source: "/rounds/:id", destination: "/rounds/_" },
    ]);
  });
});

async function env(supabaseUrl: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  const { default: nextConfig } = await import("./next.config");
  return nextConfig.env;
}

describe("next.config env", () => {
  it("ローカルSupabaseのときは、接続先をPORTのNext.jsサーバーの/supabase-apiへ差し替える", async () => {
    // Given
    vi.stubEnv("PORT", "3100");

    // When
    const result = await env("http://127.0.0.1:54321");

    // Then
    expect(result).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:3100/supabase-api",
    });
  });

  it("ローカルでないSupabaseのときは、接続先を差し替えない", async () => {
    // Given
    // When
    const result = await env("https://example.supabase.co");

    // Then
    expect(result).toBeUndefined();
  });
});
