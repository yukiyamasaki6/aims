import { beforeEach, describe, expect, it, vi } from "vitest";
import { isEmailRegistered } from "./actions";

const db = vi.hoisted(() => ({
  generateLink: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { admin: { generateLink: db.generateLink } },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isEmailRegistered", () => {
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
    expect(db.generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: "unknown@example.com",
    });
  });

  it("確認済みメールなら登録済みと判定する", async () => {
    // Given
    db.generateLink.mockResolvedValue({
      data: { user: { email_confirmed_at: "2024-01-01T00:00:00Z" } },
      error: null,
    });

    // When
    const result = await isEmailRegistered("registered@example.com");

    // Then
    expect(result).toBe(true);
  });

  it("未確認メールは未登録として扱う", async () => {
    // Given
    db.generateLink.mockResolvedValue({
      data: { user: { email_confirmed_at: null } },
      error: null,
    });

    // When
    const result = await isEmailRegistered("pending@example.com");

    // Then
    expect(result).toBe(false);
  });

  it("userが返らない場合は未登録として扱う", async () => {
    // Given
    db.generateLink.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    // When
    const result = await isEmailRegistered("noone@example.com");

    // Then
    expect(result).toBe(false);
  });
});
