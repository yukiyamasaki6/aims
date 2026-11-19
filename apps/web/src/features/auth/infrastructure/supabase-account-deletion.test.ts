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
    [
      "認可条件の不足(PT403、otp_confirmation_required)",
      "PT403",
      "otp_confirmation_required",
      403,
    ],
    [
      "対象の不一致(PT403、account_deletion_forbidden)",
      "PT403",
      "account_deletion_forbidden",
      403,
    ],
    ["他のコードの拒否(P0001)", "P0001", "拒否", 400],
    [
      "制限時間(57014)",
      "57014",
      "canceling statement due to statement timeout",
      500,
    ],
  ])(
    "%sの拒否は、専用の種類を持たない失敗に写す",
    async (_name, code, message, status) => {
      // Given
      const { account } = setup(async () => ({
        data: null,
        error: { code, message },
        status,
      }));

      // When
      const result = await account.delete("user-1");

      // Then
      expect(result).toEqual({ kind: "failed" });
    },
  );

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
  ])("%s(結果不明)も、拒否と同じ失敗に写す", async (_name, respond) => {
    // Given
    const { account } = setup(respond);

    // When
    const result = await account.delete("user-1");

    // Then
    expect(result).toEqual({ kind: "failed" });
  });
});
