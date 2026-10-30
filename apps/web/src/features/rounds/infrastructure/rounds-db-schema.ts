// biome-ignore-all lint/style/useNamingConvention: 生成した型(types/supabase.ts)のスキーマの形(Functions、Tables、Args、Returns、Row)と同じ名前で宣言するため。
// ラウンドが使うデータベースのスキーマの部分(型だけ)。生成した型(`types/supabase.ts`)と一致することは、起動地点の`narrowDatabase`が型で照合する。

// 生成した型と同じ定義。
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type RoundsDbSchema = {
  Functions: {
    create_round: {
      Args: {
        p_bow_type: string;
        p_distances: Json;
        p_format: string;
        p_id: string;
        p_name: string;
        p_round_date: string;
        p_round_event_id: string;
      };
      Returns: Json;
    };
    update_round: {
      Args: { p_changes: Json; p_round_event_id: string; p_round_id: string };
      Returns: Json;
    };
    disable_round: {
      Args: { p_round_event_id: string; p_round_id: string };
      Returns: number;
    };
    create_distance: {
      Args: {
        p_arrows_per_end: number;
        p_distance: number;
        p_distance_event_id: string;
        p_id: string;
        p_is_marked: boolean;
        p_position_key: string;
        p_round_id: string;
        p_target_face_id: string;
        p_total_ends: number;
      };
      Returns: Json;
    };
    update_distance: {
      Args: {
        p_changes: Json;
        p_distance_event_id: string;
        p_distance_id: string;
      };
      Returns: Json;
    };
    disable_distance: {
      Args: { p_distance_event_id: string; p_distance_id: string };
      Returns: Json;
    };
    record_shots: { Args: { p_shots: Json }; Returns: Json };
    clear_shots: { Args: { p_shots: Json }; Returns: Json };
  };
  Tables: {
    rounds: {
      Row: {
        id: string;
        disabled_at: string | null;
        status: string;
        round_date: string;
      };
    };
    distances: { Row: { position_key: string; id: string } };
    target_faces: { Row: Record<never, never> };
    preset_rounds: { Row: { id: string } };
  };
};
