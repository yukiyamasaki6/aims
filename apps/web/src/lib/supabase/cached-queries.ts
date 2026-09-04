import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

// unstable_cacheでラップする関数はCookie等リクエスト依存のAPIを使えないため、
// セッションを持たない匿名クライアントで問い合わせる。ここで取得するのは
// グローバル分（owner_id is null）のみで、誰が呼んでも同じ結果になる参照
// データのため、anonクライアントでも問題ない
// （supabase/migrations/20260905010000で許可。docs/security.md参照）。
function createAnonClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables in cached-queries.",
    );
  }

  return createSupabaseClient(supabaseUrl, supabaseAnonKey);
}

const TARGET_FACE_SELECT =
  "id, name, size, format, bow_type, owner_id, target_face_spots(center_x, center_y, target_face_rings(radius, color, line_color, z_index, score_str, score_int))";

export const getGlobalTargetFaces = unstable_cache(
  async () => {
    const supabase = createAnonClient();
    const { data } = await supabase
      .from("target_faces")
      .select(TARGET_FACE_SELECT)
      .is("owner_id", null)
      // 種類（アウトドア/インドア/フィールド）→サイズの順で並べる。
      // format昇順だとfield/indoor/outdoorのアルファベット順になってしまうため、
      // 降順にすることで意図した並びのoutdoor→indoor→fieldになる。
      .order("format", { ascending: false })
      .order("size", { ascending: false })
      .order("name");

    return data ?? [];
  },
  ["global-target-faces"],
  { revalidate: 3600 },
);

const ROUND_PRESET_SELECT =
  "id, name, format, bow_type, owner_id, created_at, round_preset_distances(distance_number, distance, is_marked, total_ends, arrows_per_end, target_faces(size, target_face_spots(center_x, center_y, target_face_rings(radius, color, line_color, z_index, score_str, score_int))))";

export const getGlobalRoundPresets = unstable_cache(
  async () => {
    const supabase = createAnonClient();
    const { data } = await supabase
      .from("round_presets")
      .select(ROUND_PRESET_SELECT)
      .is("owner_id", null);

    return data ?? [];
  },
  ["global-round-presets"],
  { revalidate: 3600 },
);

export { ROUND_PRESET_SELECT, TARGET_FACE_SELECT };
