import type { DbResponse } from "@/lib/supabase/contract/database";
import type { QueryFailure } from "../domain/query-outcome";

// 認証の拒否。セッションの問題かは応答だけでは決まらないため、取得の側で更新を強制して確かめる(content-fetcher.ts)。
function isAuthRejected(response: DbResponse): boolean {
  return response.status === 401 || response.error?.code === "PGRST301";
}

// 通信失敗はpostgrest-jsが例外にせずstatus 0で返す。error.messageの文字列には依存しない。
function failureOf(response: DbResponse): QueryFailure {
  if (response.status === 0) return { status: "comm-failure" };
  if (isAuthRejected(response)) return { status: "auth-rejected" };
  return { status: "failed" };
}

// 複数の応答を1つの失敗に畳む。優先順は通信失敗→認証拒否→その他の先頭。失敗が無ければundefined。
// 失敗とみなすのは、status 0かerrorがある応答。
export function failureOfResponses(
  responses: readonly DbResponse[],
): QueryFailure | undefined {
  const failed = responses.filter((r) => r.status === 0 || r.error);
  const picked =
    failed.find((r) => r.status === 0) ??
    failed.find(isAuthRejected) ??
    failed[0];
  return picked && failureOf(picked);
}
