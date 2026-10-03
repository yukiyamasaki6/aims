import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocalIdentity } from "@/features/auth/local-identity";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { fetchRoundDetail, type RoundDetail } from "./fetch-round-detail";
import { restorePendingOperations } from "./scorecard-pending";
import {
  loadPendingOperations,
  type PendingSyncOperation,
} from "./sync-outbox";

export type LoadedRoundDetail = RoundDetail & {
  // ラウンドの削除が未同期のため、一覧へ戻るか。
  leaveRound: boolean;
};

// IndexedDBが使えなくても、サーバーの状態の表示は続ける。
async function loadPending(roundId: string): Promise<PendingSyncOperation[]> {
  try {
    return await loadPendingOperations(roundId, getLocalIdentity());
  } catch {
    return [];
  }
}

// サーバーの状態へ、未送信の操作を重ねる。
// 読み取りの前後のoutboxを和集合にするのは、読み取り中に成功して消えた操作(前にだけある)と、
// 読み取り後に積まれた操作(後にだけある)の、どちらも画面から落とさないため。重ね合わせは冪等で、二重の適用は結果を変えない。
export async function loadRoundDetail(
  supabase: SupabaseClient<Database>,
  roundId: string,
): Promise<FetchResult<LoadedRoundDetail>> {
  const beforePromise = loadPending(roundId);
  const fetched = await fetchRoundDetail(supabase, roundId);
  if (fetched.status !== "ok") return fetched;

  const before = await beforePromise;
  const after = await loadPending(roundId);
  const merged = new Map<string, PendingSyncOperation>();
  for (const pending of [...before, ...after]) {
    merged.set(pending.eventId, pending);
  }
  const operations = [...merged.values()]
    .sort(
      (a, b) =>
        // 保存済みのレコードのcreatedAtは常にある。
        (a.createdAt as number) - (b.createdAt as number) ||
        a.eventId.localeCompare(b.eventId),
    )
    .map(({ operation }) => operation);

  const restore = restorePendingOperations(operations);
  const { roundConfig, distances, shots, targetFaces } = fetched.data;
  return {
    status: "ok",
    data: {
      roundConfig: restore.roundConfig(roundConfig),
      distances: restore.distances(distances),
      shots: restore.shots(shots),
      targetFaces,
      leaveRound: restore.leaveRound,
    },
  };
}
