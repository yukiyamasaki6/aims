import type { SupabaseClient } from "@supabase/supabase-js";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { hasRoundDeletion, roundOpLog } from "./_shared/round-op-log";
import { fetchRoundsList, type RoundListItem } from "./fetch-rounds-list";

export type LoadedRoundsList = {
  // サーバーの一覧。端末の列は重ねていない。
  items: RoundListItem[];
  // 端末の列で削除済みのラウンドのID。
  deleted: ReadonlySet<string>;
  // 取得の前に削除が確定していたラウンドのID。一覧の表示の開始時に、削除の印として端末の組へ反映する。
  confirmedDeletions: string[];
  // `confirmedDeletions`を反映するときの、取得の開始時刻。
  startedAt: number;
};

// サーバーの一覧と、端末の列で削除済みのラウンドを返す。
// 列は取得の前に読む。削除が確定済みのラウンドは、その後に始めた取得にどのページ・フィルタでも現れないため、取得の内容とは照合せず反映済みとする。
// ページ・フィルタ・ソートの条件は、この関数の引数と`fetchRoundsList`のクエリに足す。列にしか無いラウンドの追加などは`overlayRoundsList`に足す。
export async function loadRoundsList(
  supabase: SupabaseClient<Database>,
): Promise<FetchResult<LoadedRoundsList>> {
  const startedAt = Date.now();
  const log = await roundOpLog.loadAll();
  const deleted = new Set<string>();
  const confirmedDeletions: string[] = [];
  for (const [roundId, operations] of log) {
    if (!hasRoundDeletion(operations.map((entry) => entry.operation))) continue;
    deleted.add(roundId);
    const deletionConfirmed = operations.some(
      (entry) =>
        entry.operation.type === "round.disabled" &&
        entry.confirmedFields !== undefined,
    );
    if (deletionConfirmed) confirmedDeletions.push(roundId);
  }

  const fetched = await fetchRoundsList(supabase);
  if (fetched.status !== "ok") return fetched;
  return {
    status: "ok",
    data: { items: fetched.data, deleted, confirmedDeletions, startedAt },
  };
}
