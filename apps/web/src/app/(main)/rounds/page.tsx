import { createClient } from "@/lib/supabase/server";
import { type RoundListItem, RoundsListClient } from "./rounds-list-client";

export default async function RoundsPage() {
  const supabase = await createClient();

  const { data: rounds } = await supabase
    .from("rounds")
    .select(
      "id, name, round_date, distances(disabled_at, shots(score_int, disabled_at))",
    )
    .is("disabled_at", null)
    .order("round_date", { ascending: false });

  const roundListItems: RoundListItem[] = (rounds ?? []).map((round) => ({
    id: round.id,
    name: round.name,
    roundDate: round.round_date,
    total: round.distances
      .filter((d) => d.disabled_at === null)
      .flatMap((d) => d.shots)
      .filter((s) => s.disabled_at === null)
      .reduce((sum, s) => sum + s.score_int, 0),
  }));

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <h1 className="font-heading text-2xl leading-snug font-medium">
        ラウンド一覧
      </h1>

      <RoundsListClient initialRounds={roundListItems} />
    </main>
  );
}
