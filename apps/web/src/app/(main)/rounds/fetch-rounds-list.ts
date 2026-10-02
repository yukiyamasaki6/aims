import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchContent } from "@/features/fetch-result/fetch-content";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";

export type RoundListItem = {
  id: string;
  name: string;
  roundDate: string;
  total: number;
};

type RoundRow = {
  id: string;
  name: string;
  round_date: string;
  distances: {
    disabled_at: string | null;
    shots: { score_int: number; disabled_at: string | null }[];
  }[];
};

// 合計点は、削除されていない距離の削除されていない記録から求める。
function toRoundListItems(rounds: RoundRow[]): RoundListItem[] {
  return rounds.map((round) => ({
    id: round.id,
    name: round.name,
    roundDate: round.round_date,
    total: round.distances
      .filter((d) => d.disabled_at === null)
      .flatMap((d) => d.shots)
      .filter((s) => s.disabled_at === null)
      .reduce((sum, s) => sum + s.score_int, 0),
  }));
}

export async function fetchRoundsList(
  supabase: SupabaseClient<Database>,
): Promise<FetchResult<RoundListItem[]>> {
  const result = await fetchContent(supabase as SupabaseClient, () =>
    supabase
      .from("rounds")
      .select(
        "id, name, round_date, distances(disabled_at, shots(score_int, disabled_at))",
      )
      .is("disabled_at", null)
      .order("round_date", { ascending: false })
      .retry(false),
  );
  if (result.status !== "ok") return result;
  return { status: "ok", data: toRoundListItems(result.data ?? []) };
}
