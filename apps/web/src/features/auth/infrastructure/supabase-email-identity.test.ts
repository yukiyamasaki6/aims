import { describe, expect, it, vi } from "vitest";
import type { DatabaseGateway } from "@/lib/supabase/contract/database";
import {
  createSupabaseEmailIdentity,
  type EmailIdentityDbSchema,
} from "./supabase-email-identity";

function setup() {
  const rpc = vi.fn();
  const database = { rpc } as unknown as DatabaseGateway<EmailIdentityDbSchema>;
  return { rpc, emailIdentity: createSupabaseEmailIdentity(database) };
}

describe("メールの手段の準備(ensure)", () => {
  it("DB関数ensure_email_identityを呼び、成功を受け付けにする", async () => {
    // Given
    const { rpc, emailIdentity } = setup();
    rpc.mockResolvedValue({ data: null, error: null, status: 204 });

    // When
    const result = await emailIdentity.ensure();

    // Then
    expect(result).toEqual({ kind: "accepted" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("ensure_email_identity", {});
  });

  it("理由コード(PT403)つきの拒否は、行われなかったその他の失敗にする", async () => {
    // Given
    const { rpc, emailIdentity } = setup();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PT403", message: "rejected" },
      status: 403,
    });

    // When
    const result = await emailIdentity.ensure();

    // Then
    expect(result).toEqual({ kind: "failed", failure: { kind: "other" } });
  });

  it("コードの無い応答は、届かなかった失敗にする", async () => {
    // Given
    const { rpc, emailIdentity } = setup();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Failed to fetch" },
      status: 0,
    });

    // When
    const result = await emailIdentity.ensure();

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
  });

  it("呼び出しが投げたときは、届かなかった失敗にする", async () => {
    // Given
    const { rpc, emailIdentity } = setup();
    rpc.mockRejectedValue(new Error("network"));

    // When
    const result = await emailIdentity.ensure();

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
  });
});
