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

// スコアカードが扱うマス1つ分の記録。
export type Shot = {
  distance_id: string;
  end_number: number;
  arrow_number: number;
  shooter_id?: string;
  score_str: string;
  score_int: number;
};
