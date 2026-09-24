export const TARGET_FACE_SELECT =
  "id, name, size, format, bow_type, owner_id, target_face_spots(center_x, center_y, target_face_rings(radius, color, line_color, z_index, score_str, score_int))";

export const ROUND_PRESET_SELECT =
  "id, name, format, bow_type, owner_id, created_at, preset_distances(id, position_key, distance, is_marked, total_ends, arrows_per_end, target_faces(size, target_face_spots(center_x, center_y, target_face_rings(radius, color, line_color, z_index, score_str, score_int))))";
