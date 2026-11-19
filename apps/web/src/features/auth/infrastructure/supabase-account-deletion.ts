// biome-ignore-all lint/style/useNamingConvention: 生成した型(types/supabase.ts)のスキーマの形(Functions、Tables)と同じ名前で宣言するため。
import type { DatabaseGateway } from "@/lib/supabase/contract/database";
import type { Database } from "@/types/supabase";
import type {
  AccountDeletion,
  AccountDeletionResult,
} from "../application/delete-account";
import { UNREACHABLE } from "../domain/auth-failure";

// アカウント削除が使うデータベースのスキーマの部分。生成した型の部分集合で、定義は手で書かない。
export type AccountDeletionDbSchema = {
  Functions: Pick<Database["public"]["Functions"], "delete_account">;
  Tables: Record<never, never>;
};

// アカウント削除のDB関数(delete_account)を呼ぶ。関数は1トランザクションで、完了するか全く行われないかのどちらかである。
// 理由のコードを付けて拒否された応答(OTP不足の専用PT403はotp_required、他はother)だけを、削除が行われなかったことが確実な失敗とする。
// 応答が無い、コードの無い応答、呼び出しが投げたときは、削除が行われた可能性があるため、届かなかった(結果不明)失敗にする。
export function createSupabaseAccountDeletion(
  database: DatabaseGateway<AccountDeletionDbSchema>,
): AccountDeletion {
  return {
    async delete(expectedUserId): Promise<AccountDeletionResult> {
      try {
        const { error } = await database.rpc("delete_account", {
          expected_user_id: expectedUserId,
        });
        if (!error) return { kind: "deleted" };
        if (!error.code) return { kind: "failed", failure: UNREACHABLE };
        return {
          kind: "failed",
          failure: {
            kind:
              error.code === "PT403" &&
              error.message === "otp_confirmation_required"
                ? "otp_required"
                : "other",
          },
        };
      } catch {
        return { kind: "failed", failure: UNREACHABLE };
      }
    },
  };
}
