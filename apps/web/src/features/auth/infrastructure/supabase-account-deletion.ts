// biome-ignore-all lint/style/useNamingConvention: 生成した型(types/supabase.ts)のスキーマの形(Functions、Tables)と同じ名前で宣言するため。
import type { DatabaseGateway } from "@/lib/supabase/contract/database";
import type { Database } from "@/types/supabase";
import type {
  AccountDeletion,
  AccountDeletionResult,
} from "../application/delete-account";

// アカウント削除が使うデータベースのスキーマの部分。生成した型の部分集合で、定義は手で書かない。
export type AccountDeletionDbSchema = {
  Functions: Pick<Database["public"]["Functions"], "delete_account">;
  Tables: Record<never, never>;
};

// アカウント削除のDB関数(delete_account)を呼ぶ。関数は1トランザクションで、完了するか全く行われないかのどちらかである。
// 成功以外は、拒否の理由・通信の失敗・結果不明を区別せず、一律に失敗とする。
export function createSupabaseAccountDeletion(
  database: DatabaseGateway<AccountDeletionDbSchema>,
): AccountDeletion {
  return {
    async delete(expectedUserId): Promise<AccountDeletionResult> {
      try {
        const { error } = await database.rpc("delete_account", {
          expected_user_id: expectedUserId,
        });
        return error ? { kind: "failed" } : { kind: "deleted" };
      } catch {
        return { kind: "failed" };
      }
    },
  };
}
