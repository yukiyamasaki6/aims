import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ブラウザのSupabase接続", () => {
  it("同じ画面で取得する接続は同じ参照を返す", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");

    // When
    const first = createClient();
    const second = createClient();

    // Then
    expect(second).toBe(first);
  });
});
