import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseAuthenticator } from "./supabase-authenticator";

const credentials = {
  email: "user@example.com",
  password: "password1",
  captchaToken: "captcha-token",
};

function setup() {
  const signInWithPassword = vi.fn();
  const supabase = { auth: { signInWithPassword } } as unknown as Pick<
    SupabaseClient,
    "auth"
  >;
  const getClient = vi.fn(() => supabase);
  return {
    authenticator: createSupabaseAuthenticator(getClient),
    signInWithPassword,
    getClient,
  };
}

describe("Supabase認証の実装", () => {
  it("資格情報とトークンを認証サービスへ渡し、成功をnullで返す", async () => {
    // Given
    const { authenticator, signInWithPassword } = setup();
    signInWithPassword.mockResolvedValue({ error: null });

    // When
    const result = await authenticator.signIn(credentials);

    // Then
    expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: credentials.email,
      password: credentials.password,
      options: { captchaToken: credentials.captchaToken },
    });
    expect(result).toBeNull();
  });

  it("接続を作る関数は、認証の実装を作った時点では呼ばれない", () => {
    // Given

    // When
    const { getClient } = setup();

    // Then
    expect(getClient).not.toHaveBeenCalled();
  });

  it("接続を作る関数は、照合ごとに呼ばれる", async () => {
    // Given
    const { authenticator, signInWithPassword, getClient } = setup();
    signInWithPassword.mockResolvedValue({ error: null });

    // When
    await authenticator.signIn(credentials);
    await authenticator.signIn(credentials);

    // Then
    expect(getClient).toHaveBeenCalledTimes(2);
  });

  it("拒否された認証エラーを失敗の種類にする", async () => {
    // Given
    const { authenticator, signInWithPassword } = setup();
    signInWithPassword.mockResolvedValue({
      error: {
        name: "AuthApiError",
        code: "invalid_credentials",
        message: "raw",
      },
    });

    // When
    const result = await authenticator.signIn(credentials);

    // Then
    expect(result).toEqual({ kind: "invalid_credentials" });
  });

  it("再試行可能な通信エラーを通信断にする", async () => {
    // Given
    const { authenticator, signInWithPassword } = setup();
    signInWithPassword.mockResolvedValue({
      error: { name: "AuthRetryableFetchError", message: "fetch failed" },
    });

    // When
    const result = await authenticator.signIn(credentials);

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });

  it("例外を通信断にする", async () => {
    // Given
    const { authenticator, signInWithPassword } = setup();
    signInWithPassword.mockRejectedValue(new Error("network down"));

    // When
    const result = await authenticator.signIn(credentials);

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });

  it("接続を作る関数が投げると、通信断にする", async () => {
    // Given
    const { authenticator, getClient, signInWithPassword } = setup();
    getClient.mockImplementation(() => {
      throw new Error("Missing Supabase environment variables.");
    });

    // When
    const result = await authenticator.signIn(credentials);

    // Then
    expect(result).toEqual({ kind: "unreachable" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
