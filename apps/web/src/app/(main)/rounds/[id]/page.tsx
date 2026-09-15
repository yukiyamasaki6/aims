import { notFound } from "next/navigation";
import {
  getGlobalTargetFaces,
  TARGET_FACE_SELECT,
} from "@/lib/supabase/reference-queries";
import { createClient } from "@/lib/supabase/server";
import { ScorecardClient } from "./scorecard-client";

export default async function RoundPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // round・distances・target_facesは互いに独立しているため、同じ認証済み
  // セッションで並列実行する。shotsのみdistances取得後でよい。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: round },
    { data: distances },
    { data: personalTargetFaces },
    globalTargetFaces,
  ] = await Promise.all([
    supabase
      .from("rounds")
      .select("id, name, round_date, format, bow_type")
      .eq("id", id)
      .is("disabled_at", null)
      .maybeSingle(),
    supabase
      .from("distances")
      .select(
        "id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked",
      )
      .eq("round_id", id)
      .is("disabled_at", null)
      .order("position_key")
      .order("id"),
    user
      ? supabase
          .from("target_faces")
          .select(TARGET_FACE_SELECT)
          .eq("owner_id", user.id)
      : Promise.resolve({ data: [] }),
    getGlobalTargetFaces(supabase),
  ]);

  if (!round) {
    notFound();
  }

  const distanceIds = (distances ?? []).map((d) => d.id);

  const { data: shots } =
    distanceIds.length > 0
      ? await supabase
          .from("shots")
          .select(
            "distance_id, end_number, arrow_number, shooter_id, score_str, score_int",
          )
          .in("distance_id", distanceIds)
          .is("disabled_at", null)
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
      targetFaces={[...(personalTargetFaces ?? []), ...globalTargetFaces]}
    />
  );
}
