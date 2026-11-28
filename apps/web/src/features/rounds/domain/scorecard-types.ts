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
export type Shot = Pick<
  Tables<"shots">,
  | "distance_id"
  | "end_number"
  | "score_str"
  | "score_int"
  | "shot_number"
  | "shooter_number"
>;

// マスの射手。取り消した矢のマスも持つ。
export type CellShooter = Pick<
  Shot,
  "distance_id" | "end_number" | "shot_number" | "shooter_number"
>;

// ラウンドの射手。番号で区別し、利用者に紐づかない射手は利用者と役割がnull。
export type Shooter = Pick<Tables<"round_users">, "user_id" | "role"> & {
  shooter_number: number;
};
