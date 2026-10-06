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
  // 取得の前に削除が確定していたラウンドの、確定済みの操作のeventId。一覧の表示の開始時に列から外す。
  reflected: { roundId: string; eventIds: string[] }[];
};

// サーバーの一覧と、端末の列で削除済みのラウンドを返す。
// 列は取得の前に読む。削除が確定済みのラウンドは、その後に始めた取得にどのページ・フィルタでも現れないため、取得の内容とは照合せず反映済みとする。
// ページ・フィルタ・ソートの条件は、この関数の引数と`fetchRoundsList`のクエリに足す。列にしか無いラウンドの追加などは`overlayRoundsList`に足す。
export async function loadRoundsList(
  supabase: SupabaseClient<Database>,
): Promise<FetchResult<LoadedRoundsList>> {
  const log = await roundOpLog.loadAll();
  const deleted = new Set<string>();
  const reflected: LoadedRoundsList["reflected"] = [];
  for (const [roundId, operations] of log) {
    if (!hasRoundDeletion(operations.map((entry) => entry.operation))) continue;
    deleted.add(roundId);
    const confirmed = operations.filter(
      (entry) => entry.confirmedFields !== undefined,
    );
    const deletionConfirmed = confirmed.some(
      (entry) => entry.operation.type === "round.disabled",
    );
    if (deletionConfirmed) {
      reflected.push({
        roundId,
        eventIds: confirmed.map((entry) => entry.operation.eventId),
      });
    }
  }

  const fetched = await fetchRoundsList(supabase);
  if (fetched.status !== "ok") return fetched;
  return { status: "ok", data: { items: fetched.data, deleted, reflected } };
}
