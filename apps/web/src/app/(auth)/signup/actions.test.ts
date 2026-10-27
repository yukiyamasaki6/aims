import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEmailRegistered } from "./actions";

const db = vi.hoisted(() => ({
  generateLink: vi.fn(),
  createClient: vi.fn(),
}));

// SDKは境界のため差し替える。管理者の接続(createAdminClient)と判定(createSupabaseRegistrationCheck)は実物を通す。
vi.mock("@supabase/supabase-js", () => ({
  createClient: db.createClient,
}));

beforeEach(() => {
  vi.resetAllMocks();
  db.createClient.mockImplementation(() => ({
    auth: { admin: { generateLink: db.generateLink } },
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isEmailRegistered", () => {
  it("確認済みのユーザーが返れば登録済みと判定し、再設定用のリンクの生成を依頼する", async () => {
    // Given
    db.generateLink.mockResolvedValue({
      data: { user: { email_confirmed_at: "2024-01-01T00:00:00Z" } },
      error: null,
    });

    // When
    const result = await isEmailRegistered("registered@example.com");

    // Then
    expect(result).toBe(true);
    expect(db.generateLink).toHaveBeenCalledExactlyOnceWith({
      type: "recovery",
      email: "registered@example.com",
    });
  });

  it("生成に失敗した場合は未登録として扱う", async () => {
    // Given
    db.generateLink.mockResolvedValue({
      data: { user: null },
      error: { message: "User not found" },
    });

    // When
    const result = await isEmailRegistered("unknown@example.com");

    // Then
    expect(result).toBe(false);
  });

  it("管理者の秘密鍵で、セッションを保たない接続を作る", async () => {
    // Given
    db.generateLink.mockResolvedValue({ data: { user: null }, error: null });

    // When
    await isEmailRegistered("user@example.com");

    // Then
    expect(db.createClient).toHaveBeenCalledExactlyOnceWith(
      "https://example.supabase.co",
      "secret-key",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });

  it("生成の呼び出しが投げた場合は、未登録とせず、そのまま投げる", async () => {
    // Given
    db.generateLink.mockRejectedValue(new Error("network down"));

    // When
    const result = isEmailRegistered("user@example.com");

    // Then
    await expect(result).rejects.toThrow("network down");
  });

  it("環境変数が無いときは、接続を作らず投げる", async () => {
    // Given
    vi.stubEnv("SUPABASE_SECRET_KEY", "");

    // When
    const result = isEmailRegistered("user@example.com");

    // Then
    await expect(result).rejects.toThrow("Missing Supabase environment");
    expect(db.createClient).not.toHaveBeenCalled();
    expect(db.generateLink).not.toHaveBeenCalled();
  });
});
