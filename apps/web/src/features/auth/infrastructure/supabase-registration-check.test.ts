import { describe, expect, it, vi } from "vitest";
import { createSupabaseRegistrationCheck } from "./supabase-registration-check";

function setup() {
  const generateLink = vi.fn();
  const getAdminClient = vi.fn(
    () => ({ auth: { admin: { generateLink } } }) as never,
  );
  return {
    isRegistered: createSupabaseRegistrationCheck(getAdminClient),
    generateLink,
    getAdminClient,
  };
}

const userNotFound = {
  name: "AuthApiError",
  code: "user_not_found",
  status: 404,
  message: "User not found",
};

describe("Supabaseの登録済み判定", () => {
  it("確認済みメールなら登録済みと判定する", async () => {
    // Given
    const { isRegistered, generateLink } = setup();
    generateLink.mockResolvedValue({
      data: { user: { email_confirmed_at: "2024-01-01T00:00:00Z" } },
      error: null,
    });

    // When
    const result = await isRegistered("registered@example.com");

    // Then
    expect(result).toBe(true);
  });

  it("未確認メールは未登録として扱う", async () => {
    // Given
    const { isRegistered, generateLink } = setup();
    generateLink.mockResolvedValue({
      data: { user: { email_confirmed_at: null } },
      error: null,
    });

    // When
    const result = await isRegistered("pending@example.com");

    // Then
    expect(result).toBe(false);
  });

  it("userが返らない場合は未登録として扱う", async () => {
    // Given
    const { isRegistered, generateLink } = setup();
    generateLink.mockResolvedValue({ data: { user: null }, error: null });

    // When
    const result = await isRegistered("noone@example.com");

    // Then
    expect(result).toBe(false);
  });

  it("利用者が見つからない(user_not_found)場合は未登録として扱う", async () => {
    // Given
    const { isRegistered, generateLink } = setup();
    generateLink.mockResolvedValue({
      data: { user: null },
      error: userNotFound,
    });

    // When
    const result = await isRegistered("unknown@example.com");

    // Then
    expect(result).toBe(false);
    expect(generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: "unknown@example.com",
    });
  });

  it.each([
    [
      "管理側を使えない(not_admin)",
      {
        name: "AuthApiError",
        code: "not_admin",
        status: 403,
        message: "User not allowed",
      },
    ],
    [
      "管理側を使えない(no_authorization)",
      {
        name: "AuthApiError",
        code: "no_authorization",
        status: 401,
        message: "No authorization",
      },
    ],
    [
      "未知のコード",
      {
        name: "AuthApiError",
        code: "unexpected_failure",
        status: 500,
        message: "Unexpected",
      },
    ],
    [
      "届かない(通信の断)",
      { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" },
    ],
  ])(
    "%sのエラーが返った場合は、未登録とせず、そのエラーを投げる",
    async (_name, error) => {
      // Given
      const { isRegistered, generateLink } = setup();
      generateLink.mockResolvedValue({ data: { user: null }, error });

      // When
      const result = isRegistered("user@example.com");

      // Then
      await expect(result).rejects.toBe(error);
    },
  );

  // 実際の応答は、エラーのときuserを持たない。エラーを優先する判定そのものを確かめるため、あえてuserを付ける。
  it("user_not_foundのエラーが返った場合は、確認済みのuserが付いていても未登録として扱う", async () => {
    // Given
    const { isRegistered, generateLink } = setup();
    generateLink.mockResolvedValue({
      data: { user: { email_confirmed_at: "2024-01-01T00:00:00Z" } },
      error: userNotFound,
    });

    // When
    const result = await isRegistered("user@example.com");

    // Then
    expect(result).toBe(false);
  });

  // 実際の応答は、エラーのときuserを持たない。エラーを優先する判定そのものを確かめるため、あえてuserを付ける。
  it("それ以外のエラーが返った場合は、確認済みのuserが付いていても登録済みとせず、投げる", async () => {
    // Given
    const { isRegistered, generateLink } = setup();
    const error = {
      name: "AuthApiError",
      code: "not_admin",
      status: 403,
      message: "User not allowed",
    };
    generateLink.mockResolvedValue({
      data: { user: { email_confirmed_at: "2024-01-01T00:00:00Z" } },
      error,
    });

    // When
    const result = isRegistered("user@example.com");

    // Then
    await expect(result).rejects.toBe(error);
  });

  it("生成の呼び出しが投げた場合は、未登録とせず、そのまま投げる", async () => {
    // Given
    const { isRegistered, generateLink } = setup();
    generateLink.mockRejectedValue(new Error("network down"));

    // When
    const result = isRegistered("user@example.com");

    // Then
    await expect(result).rejects.toThrow("network down");
  });

  it("管理者の接続を作る関数が投げた場合は、そのまま投げる", async () => {
    // Given
    const getAdminClient = vi.fn(() => {
      throw new Error("Missing Supabase environment variables");
    });
    const isRegistered = createSupabaseRegistrationCheck(getAdminClient);

    // When
    const result = isRegistered("user@example.com");

    // Then
    await expect(result).rejects.toThrow("Missing Supabase environment");
  });

  it("管理者の接続は、判定のたびに取得する", async () => {
    // Given
    const { isRegistered, generateLink, getAdminClient } = setup();
    generateLink.mockResolvedValue({ data: { user: null }, error: null });
    expect(getAdminClient).not.toHaveBeenCalled();

    // When
    await isRegistered("a@example.com");
    await isRegistered("b@example.com");

    // Then
    expect(getAdminClient).toHaveBeenCalledTimes(2);
  });
});
