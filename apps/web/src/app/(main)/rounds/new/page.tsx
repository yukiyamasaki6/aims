import { createClient } from "@/lib/supabase/server";
import { type Preset, RoundPresetSelect } from "./round-preset-select-client";

export default async function NewRoundPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ownerFilter = user
    ? `owner_id.eq.${user.id},owner_id.is.null`
    : "owner_id.is.null";

  const { data: presets } = await supabase
    .from("round_presets")
    .select(
      "id, name, owner_id, round_preset_distances(distance_number, distance, total_ends, arrows_per_end, target_faces(size, target_face_spots(target_face_rings(radius, color, line_color, z_index, score_str, score_int))))",
    )
    .or(ownerFilter)
    .order("name");

  // round_preset_distances.target_facesはFKの多重度（多対1）上つねに単一のオブジェクトだが、
  // 生成型は入れ子embedのカーディナリティを配列として広く推論するため、実体に合わせてキャストする。
  const typedPresets = (presets ?? []) as unknown as (Preset & {
    owner_id: string | null;
  })[];

  const personalPresets = typedPresets.filter((p) => p.owner_id !== null);
  const globalPresets = typedPresets.filter((p) => p.owner_id === null);

  return (
    <RoundPresetSelect
      personalPresets={personalPresets}
      globalPresets={globalPresets}
    />
  );
}
