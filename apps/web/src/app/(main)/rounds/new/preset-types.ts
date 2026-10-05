import type { TargetFaceRing } from "../_shared/target-face-icon";

type PresetDistance = {
  id: string;
  position_key: string;
  distance: number | null;
  is_marked: boolean;
  total_ends: number;
  arrows_per_end: number;
  target_face_id: string;
  target_faces: {
    size: number;
    target_face_spots: {
      center_x: number;
      center_y: number;
      target_face_rings: TargetFaceRing[];
    }[];
  } | null;
};

export type Preset = {
  id: string;
  name: string;
  format: string;
  bow_type: string;
  preset_distances: PresetDistance[];
};

export type PresetWithMeta = Preset & {
  owner_id: string | null;
  created_at: string;
};
