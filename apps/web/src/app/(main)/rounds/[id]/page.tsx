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
    .select(
      "id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked",
    )
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

  const { data: targetFaces } = await supabase
    .from("target_faces")
    .select(
      "id, name, size, format, bow_type, target_face_spots(center_x, center_y, target_face_rings(radius, color, line_color, z_index, score_str, score_int))",
    )
    // 種類（アウトドア/インドア/フィールド）→サイズの順で並べる。
    // format昇順だとfield/indoor/outdoorのアルファベット順になってしまうため、
    // 降順にすることで意図した並びのoutdoor→indoor→fieldになる。
    .order("format", { ascending: false })
    .order("size", { ascending: false })
    .order("name");

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
      targetFaces={targetFaces ?? []}
    />
  );
}
