import { beforeEach, describe, expect, it, vi } from "vitest";
import { isEmailRegistered } from "./actions";

const db = vi.hoisted(() => ({
  generateLink: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { generateLink: db.generateLink } },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isEmailRegistered", () => {
  it("生成に失敗した場合は未登録として扱う", async () => {
    db.generateLink.mockResolvedValue({
      data: { user: null },
      error: { message: "User not found" },
    });

    const result = await isEmailRegistered("unknown@example.com");

    expect(result).toBe(false);
    expect(db.generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: "unknown@example.com",
    });
  });

  it("確認済みメールなら登録済みと判定する", async () => {
    db.generateLink.mockResolvedValue({
      data: { user: { email_confirmed_at: "2024-01-01T00:00:00Z" } },
      error: null,
    });

    expect(await isEmailRegistered("registered@example.com")).toBe(true);
  });

  it("未確認メールは未登録として扱う", async () => {
    db.generateLink.mockResolvedValue({
      data: { user: { email_confirmed_at: null } },
      error: null,
    });

    expect(await isEmailRegistered("pending@example.com")).toBe(false);
  });

  it("userが返らない場合は未登録として扱う", async () => {
    db.generateLink.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    expect(await isEmailRegistered("noone@example.com")).toBe(false);
  });
});
