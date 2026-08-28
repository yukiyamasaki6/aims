import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ScorecardClient } from "./scorecard-client";

export default async function RoundPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: round } = await supabase
    .from("rounds")
    .select("id, name, round_date, format, bow_type")
    .eq("id", id)
    .maybeSingle();

  if (!round) {
    notFound();
  }

  const { data: distances } = await supabase
    .from("distances")
    .select("id, distance_number, distance, total_ends, arrows_per_end")
    .eq("round_id", id)
    .order("distance_number");

  const distanceIds = (distances ?? []).map((d) => d.id);

  const { data: shots } =
    distanceIds.length > 0
      ? await supabase
          .from("shots")
          .select("distance_id, end_number, arrow_number, score_str, score_int")
          .in("distance_id", distanceIds)
      : { data: [] };

  return (
    <ScorecardClient
      roundId={round.id}
      initialRoundConfig={{
        name: round.name,
        roundDate: round.round_date,
        format: round.format,
        bowType: round.bow_type,
      }}
      distances={distances ?? []}
      initialShots={shots ?? []}
    />
  );
}
