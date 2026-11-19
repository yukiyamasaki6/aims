// biome-ignore-all lint/style/useNamingConvention: 生成した型(types/supabase.ts)のスキーマの形(Functions、Tables)と、DBの応答の項目名に合わせるため。
import { describe, expect, it, vi } from "vitest";
import type {
  DatabaseGateway,
  DbResponse,
} from "@/lib/supabase/contract/database";
import {
  type AccountDeletionDbSchema,
  createSupabaseAccountDeletion,
} from "./supabase-account-deletion";

function setup(respond: () => Promise<DbResponse>) {
  const rpc = vi.fn(respond);
  const database = {
    select: async () => {
      throw new Error("削除は問い合わせを使わない");
    },
    delete: async () => {
      throw new Error("削除は表の削除を使わない");
    },
    rpc,
  } as unknown as DatabaseGateway<AccountDeletionDbSchema>;
  return { account: createSupabaseAccountDeletion(database), rpc };
}

describe("createSupabaseAccountDeletion", () => {
  it("成功の応答は、削除された結果に写し、RPCへ対象IDを渡す", async () => {
    // Given
    const { account, rpc } = setup(async () => ({
      data: null,
      error: null,
      status: 204,
    }));

    // When
    const result = await account.delete("user-1");

    // Then
    expect(result).toEqual({ kind: "deleted" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("delete_account", {
      expected_user_id: "user-1",
    });
  });

  it.each([
    ["PT403(対象不一致)は、その他", "PT403", "other"],
    [
      "他のコード(PT403以外)は、削除が行われなかったことが確実なその他",
      "P0001",
      "other",
    ],
    [
      "制限時間(57014)も、DBが全体を取り消しているため、その他",
      "57014",
      "other",
    ],
  ])("コード付きの拒否のうち、%sに写す", async (_name, code, kind) => {
    // Given
    const { account } = setup(async () => ({
      data: null,
      error: { code, message: "拒否" },
      status: 403,
    }));

    // When
    const result = await account.delete("user-1");

    // Then
    expect(result).toEqual({ kind: "failed", failure: { kind } });
  });

  it.each([
    [
      "コードの無い応答",
      async () => ({
        data: null,
        error: { message: "bad gateway" },
        status: 502,
      }),
    ],
    [
      "空のコードの応答",
      async () => ({
        data: null,
        error: { code: "", message: "aborted" },
        status: 0,
      }),
    ],
    [
      "呼び出しの例外(接続を得られない、通信の断)",
      async (): Promise<DbResponse> => {
        throw new Error("network down");
      },
    ],
  ])("%sは、結果不明(届かなかった失敗)に写す", async (_name, respond) => {
    // Given
    const { account } = setup(respond);

    // When
    const result = await account.delete("user-1");

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
  });
});

it.each([
  ["PT403", "otp_confirmation_required", "otp_required"],
  ["PT403", "account_deletion_forbidden", "other"],
  ["P0001", "otp_confirmation_required", "other"],
])("%sと%sの組合せだけを%sへ変換する", async (code, message, kind) => {
  // Given
  const { account } = setup(async () => ({
    data: null,
    error: { code, message },
    status: 403,
  }));
  // When
  const result = await account.delete("user-1");
  // Then
  expect(result).toEqual({ kind: "failed", failure: { kind } });
});
