import { signInAsTestUser } from "./rounds";

const DEFAULT_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001"; // 10点的（アウトドア・122cm）

// 個人プリセットが必要なテストのGiven用。プリセット保存のUI操作を経由せず、
// 本番アプリにテスト専用のAPIを持たせないため、supabase-jsから対象ユーザーで
// サインインしてsave_round_as_preset RPCを直接呼ぶ。
export async function createPreset(input: {
  email: string;
  password: string;
  name: string;
  format?: string;
  bowType?: string;
  distances: { distance: number; totalEnds: number; arrowsPerEnd: number }[];
}): Promise<string> {
  const { supabase } = await signInAsTestUser(input.email, input.password);

  const { data: presetId, error } = await supabase.rpc("save_round_as_preset", {
    p_name: input.name,
    p_format: input.format ?? "outdoor",
    p_bow_type: input.bowType ?? "recurve",
    p_distances: input.distances.map((d, index) => ({
      position_key: String(index + 1).padStart(12, "0"),
      distance: d.distance,
      total_ends: d.totalEnds,
      arrows_per_end: d.arrowsPerEnd,
      target_face_id: DEFAULT_TARGET_FACE_ID,
      is_marked: true,
    })),
  });

  if (error || !presetId) {
    throw error ?? new Error("プリセットの作成に失敗しました。");
  }

  return presetId;
}
