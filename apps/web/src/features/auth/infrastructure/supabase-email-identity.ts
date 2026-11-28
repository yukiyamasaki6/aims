// biome-ignore-all lint/style/useNamingConvention: 生成した型(types/supabase.ts)のスキーマの形(Functions、Tables、Args、Returns)と同じ名前で宣言するため。
import type { DatabaseGateway } from "@/lib/supabase/contract/database";
import type { CallResult } from "../application/call-result";
import type { EmailIdentityPreparation } from "../application/link-google";
import { UNREACHABLE } from "../domain/auth-failure";

// DB関数の部分。引数の無い関数で、生成した型は`Args: Record<PropertyKey, never>`のため、呼び出しの型は空の引数の形で書く。
export type EmailIdentityDbSchema = {
  Functions: { ensure_email_identity: { Args: object; Returns: undefined } };
  Tables: Record<never, never>;
};

// DBの関数`ensure_email_identity()`を呼ぶ。メールの手段が無ければ作る(冪等)。
// DBが理由コードを付けて拒否した応答は`other`(行われなかったことが確実)、応答が無い、コードの無い応答、呼び出しが投げたときは届かなかった失敗にする。
export function createSupabaseEmailIdentity(
  database: DatabaseGateway<EmailIdentityDbSchema>,
): EmailIdentityPreparation {
  return {
    ensure: async (): Promise<CallResult> => {
      try {
        const { error } = await database.rpc("ensure_email_identity", {});
        if (!error) return { kind: "accepted" };
        return error.code
          ? { kind: "failed", failure: { kind: "other" } }
          : { kind: "failed", failure: UNREACHABLE };
      } catch {
        return { kind: "failed", failure: UNREACHABLE };
      }
    },
  };
}
