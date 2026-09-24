import type { createClient } from "@/lib/supabase/server";
import {
  ROUND_PRESET_SELECT,
  TARGET_FACE_SELECT,
} from "./reference-query-constants";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

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

export async function getGlobalRoundPresets(supabase: ServerSupabaseClient) {
  const { data, error } = await supabase
    .from("preset_rounds")
    .select(ROUND_PRESET_SELECT)
    .is("owner_id", null);

  if (error) throw error;
  return data;
}
