// スコアカードが扱う距離の行。
export type Distance = {
  id: string;
  position_key: string;
  distance: number | null;
  total_ends: number;
  arrows_per_end: number;
  target_face_id: string;
  is_marked: boolean;
};

// スコアカードが扱う矢1本の記録。矢はIDで識別し、エンド内の位置を持たない。
// 射順(`shot_number`)は任意で、nullは射順不明。
export type Shot = {
  id: string;
  distance_id: string;
  end_number: number;
  shooter_id?: string;
  score_str: string;
  score_int: number;
  shot_number: number | null;
};
