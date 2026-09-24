import type { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

const TARGET_FACE_SELECT =
  "id, name, size, format, bow_type, owner_id, target_face_spots(center_x, center_y, target_face_rings(radius, color, line_color, z_index, score_str, score_int))";

export async function getGlobalTargetFaces(supabase: ServerSupabaseClient) {
  const { data, error } = await supabase
    .from("target_faces")
    .select(TARGET_FACE_SELECT)
    .is("owner_id", null)
    // 種類（アウトドア/インドア/フィールド）→サイズの順で並べる。
    // format昇順だとfield/indoor/outdoorのアルファベット順になってしまうため、
    // 降順にすることで意図した並びのoutdoor→indoor→fieldになる。
    .order("format", { ascending: false })
    .order("size", { ascending: false })
    .order("name");

  if (error) throw error;
  return data;
}

const ROUND_PRESET_SELECT =
  "id, name, format, bow_type, owner_id, created_at, preset_distances(id, position_key, distance, is_marked, total_ends, arrows_per_end, target_faces(size, target_face_spots(center_x, center_y, target_face_rings(radius, color, line_color, z_index, score_str, score_int))))";

export async function getGlobalRoundPresets(supabase: ServerSupabaseClient) {
  const { data, error } = await supabase
    .from("preset_rounds")
    .select(ROUND_PRESET_SELECT)
    .is("owner_id", null);

  if (error) throw error;
  return data;
}

export { ROUND_PRESET_SELECT, TARGET_FACE_SELECT };
