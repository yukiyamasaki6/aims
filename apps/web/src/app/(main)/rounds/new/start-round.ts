import { createClient } from "@/lib/supabase/client";
import { comparePositionKey } from "../_shared/position-key";

// preset_roundsから取得する、ラウンドの作成に必要なプリセットの内容。
type PresetForRound = {
  format: string;
  bow_type: string;
  preset_distances: {
    id: string;
    position_key: string;
    distance: number | null;
    is_marked: boolean;
    total_ends: number;
    arrows_per_end: number;
    target_face_id: string;
  }[];
};

// create_roundへ渡す距離。
type RoundDistance = {
  distance_event_id: string;
  id: string;
  position_key: string;
  distance: number | null;
  is_marked: boolean;
  total_ends: number;
  arrows_per_end: number;
  target_face_id: string;
};

// created: ラウンドを作成できた。
// failed: 作成できず、画面に表示するエラーメッセージがある。
// discarded: 完了を待つ間に画面がアンマウントされたため、結果を破棄した。
type StartRoundResult =
  | { status: "created"; roundId: string }
  | { status: "failed"; error: string }
  | { status: "discarded" };

// プリセットの距離をposition_key順に並べ、新しいIDを振ったラウンドの距離へ変換する。
function toRoundDistances(
  presetDistances: PresetForRound["preset_distances"],
  generateId: () => string,
): RoundDistance[] {
  return [...presetDistances]
    .sort((a, b) =>
      comparePositionKey(a.position_key, a.id, b.position_key, b.id),
    )
    .map((d) => ({
      distance_event_id: generateId(),
      id: generateId(),
      position_key: d.position_key,
      distance: d.distance,
      is_marked: d.is_marked,
      total_ends: d.total_ends,
      arrows_per_end: d.arrows_per_end,
      target_face_id: d.target_face_id,
    }));
}

// create_roundの引数を組み立てる。
// プリセットを選択していない場合は、屋外・リカーブの距離無しのラウンドとする。
function buildCreateRoundArgs(
  preset: PresetForRound | null,
  generateId: () => string,
  now: Date,
) {
  const distances = preset
    ? toRoundDistances(preset.preset_distances, generateId)
    : [];
  const newRoundId = generateId();
  return {
    p_round_event_id: generateId(),
    p_id: newRoundId,
    p_name: "",
    p_round_date: now.toISOString().slice(0, 10),
    p_format: preset?.format ?? "outdoor",
    p_bow_type: preset?.bow_type ?? "recurve",
    p_distances: distances,
  };
}

// 選択中のプリセット（未選択ならnull）からラウンドを作成する。
// 作成後の遷移と、送信中の状態の管理は呼び出し元の画面が担う。
export async function startRound({
  presetId,
  isMounted,
  generateId,
  now,
}: {
  presetId: string | null;
  isMounted: () => boolean;
  generateId: () => string;
  now: () => Date;
}): Promise<StartRoundResult> {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    if (!isMounted()) return { status: "discarded" };

    if (!user) {
      return { status: "failed", error: "サインインが必要です。" };
    }

    let preset: PresetForRound | null = null;
    if (presetId) {
      const { data, error: presetError } = await supabase
        .from("preset_rounds")
        .select(
          "format, bow_type, preset_distances(id, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id)",
        )
        .eq("id", presetId)
        .maybeSingle();

      if (!isMounted()) return { status: "discarded" };

      if (presetError || !data) {
        return { status: "failed", error: "プリセットの取得に失敗しました。" };
      }
      preset = data;
    }

    const { data: roundId, error } = await supabase.rpc(
      "create_round",
      buildCreateRoundArgs(preset, generateId, now()),
    );

    if (!isMounted()) return { status: "discarded" };

    if (error || !roundId) {
      return {
        status: "failed",
        error: error?.message ?? "ラウンドの作成に失敗しました。",
      };
    }

    return { status: "created", roundId };
  } catch {
    if (!isMounted()) return { status: "discarded" };
    return {
      status: "failed",
      error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
    };
  }
}
