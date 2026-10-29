import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionReader } from "@/features/auth";
import { createContentFetcher } from "@/features/rounds/application/fetch-content";
import type { FetchResult } from "@/features/rounds/domain/fetch-result";
import type { RoundListItem } from "@/features/rounds/domain/round-list";
import { createAuthSignInReader } from "@/features/rounds/infrastructure/auth-sign-in-reader";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import type { Database } from "@/types/supabase";

export type { RoundListItem };

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
  sessionReader: SessionReader,
): Promise<FetchResult<RoundListItem[]>> {
  // 呼び出しのたびに取得の部品を作る(未適用の領域で振る舞いを保つため)。
  const { fetchContent } = createContentFetcher({
    signIn: createAuthSignInReader(sessionReader),
    connectivity: createBrowserConnectivity(),
    clock: createBrowserClock(),
  });
  const result = await fetchContent(() =>
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
