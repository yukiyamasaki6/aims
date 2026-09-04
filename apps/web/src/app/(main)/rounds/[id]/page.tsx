import { notFound } from "next/navigation";
import {
  getGlobalTargetFaces,
  TARGET_FACE_SELECT,
} from "@/lib/supabase/cached-queries";
import { createClient } from "@/lib/supabase/server";
import { ScorecardClient } from "./scorecard-client";

export default async function RoundPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // round・distances・target_faces（個人分）は互いに独立しているため並列実行する。
  // target_facesのグローバル分はunstable_cacheされた匿名クエリで別途取得する
  // （毎回のDB問い合わせを避けるため）。shotsのみdistances取得後でよい。
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
      .maybeSingle(),
    supabase
      .from("distances")
      .select(
        "id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked",
      )
      .eq("round_id", id)
      .order("distance_number"),
    user
      ? supabase
          .from("target_faces")
          .select(TARGET_FACE_SELECT)
          .eq("owner_id", user.id)
      : Promise.resolve({ data: [] }),
    getGlobalTargetFaces(),
  ]);

  if (!round) {
    notFound();
  }

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
      targetFaces={[...(personalTargetFaces ?? []), ...globalTargetFaces]}
    />
  );
}
