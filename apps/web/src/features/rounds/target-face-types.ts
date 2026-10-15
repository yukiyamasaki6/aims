export type TargetFaceRing = {
  radius: number;
  color: string;
  line_color: string | null;
  z_index: number;
  score_str: string;
  score_int: number;
};

export type TargetFaceSpotLayout = {
  center_x: number;
  center_y: number;
  target_face_rings: TargetFaceRing[];
};

export type TargetFaceOption = {
  id: string;
  name: string;
  size: number;
  format: string;
  bow_type: string[];
  target_face_spots: TargetFaceSpotLayout[];
};
