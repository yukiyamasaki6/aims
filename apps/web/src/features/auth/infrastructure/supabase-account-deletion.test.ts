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
  it("成功の応答は、削除された結果に写し、RPC名はdelete_accountで、引数(パスワードを含む)を渡さない", async () => {
    // Given
    const { account, rpc } = setup(async () => ({
      data: null,
      error: null,
      status: 204,
    }));

    // When
    const result = await account.delete();

    // Then
    expect(result).toEqual({ kind: "deleted" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("delete_account", {});
  });

  it.each([
    ["PT403(確認からの経過)も、その他", "PT403", "other"],
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
    const result = await account.delete();

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
    const result = await account.delete();

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
  });
});
