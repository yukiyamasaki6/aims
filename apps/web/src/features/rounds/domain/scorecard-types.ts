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

// スコアカードが扱う矢1本の記録。矢はIDで識別し、エンド内の位置を持たない。
// 射順(`shot_number`)は任意で、nullは射順不明。
// `shooter_id`は任意で、端末が射手を含めない操作がある。
export type Shot = Pick<
  Tables<"shots">,
  | "id"
  | "distance_id"
  | "end_number"
  | "score_str"
  | "score_int"
  | "shot_number"
> &
  Partial<Pick<Tables<"shots">, "shooter_id">>;
