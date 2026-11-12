// biome-ignore-all lint/style/useNamingConvention: 生成した型(types/supabase.ts)のスキーマの形(Functions、Tables、Row)と同じ名前で宣言するため。
import type { Database } from "@/types/supabase";

export type { Json } from "@/types/supabase";

type Full = Database["public"];

type CreateDistance = Full["Functions"]["create_distance"];

// 距離の作成は、SQL側が`p_distance`にnullを受け付ける(未定の距離)が、生成した型は数値で出力する。
type CreateDistanceWithNullable = Omit<CreateDistance, "Args"> & {
  Args: Omit<CreateDistance["Args"], "p_distance"> & {
    p_distance: number | null;
  };
};

// ラウンドが使うデータベースのスキーマの部分。生成した型(`types/supabase.ts`)の部分集合で、列の定義は手で書かない。
export type RoundsDbSchema = {
  Functions: Pick<
    Full["Functions"],
    | "create_round"
    | "update_round"
    | "disable_round"
    | "update_distance"
    | "disable_distance"
    | "save_round_as_preset"
    | "record_shots"
    | "clear_shots"
  > & { create_distance: CreateDistanceWithNullable };
  Tables: {
    rounds: {
      Row: Pick<
        Full["Tables"]["rounds"]["Row"],
        | "id"
        | "disabled_at"
        | "status"
        | "round_date"
        | "format"
        | "bow_type"
        | "created_at"
      >;
    };
    distances: {
      Row: Pick<Full["Tables"]["distances"]["Row"], "position_key" | "id">;
    };
    target_faces: { Row: Record<never, never> };
    preset_rounds: { Row: Pick<Full["Tables"]["preset_rounds"]["Row"], "id"> };
  };
};
