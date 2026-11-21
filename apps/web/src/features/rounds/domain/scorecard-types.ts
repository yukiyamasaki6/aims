import type { Tables } from "@/types/supabase";

// スコアカードが扱う距離の行。
export type Distance = Pick<
  Tables<"distances">,
  | "id"
  | "position_key"
  | "distance"
  | "total_ends"
  | "arrows_per_end"
  | "target_face_id"
  | "is_marked"
>;

// スコアカードが扱う矢1本の記録。矢はマス(距離、エンド、`shot_number`)で識別し、`shot_number`が射順を兼ねる。
// `shooter_id`は任意で、端末が射手を含めない操作がある。
export type Shot = Pick<
  Tables<"shots">,
  "distance_id" | "end_number" | "score_str" | "score_int" | "shot_number"
> &
  Partial<Pick<Tables<"shots">, "shooter_id">>;
