"use server";

import { createClient } from "@/lib/supabase/server";

export async function updateDistance(input: {
  distanceId: string;
  distance: number | null;
  totalEnds: number;
  arrowsPerEnd: number;
  targetFaceId: string;
  isMarked: boolean;
}): Promise<{ error: string } | undefined> {
  if (input.isMarked && input.distance === null) {
    return { error: "Markedの場合は距離（m）を入力してください。" };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  // shotsの有無チェックと、その結果に応じて更新対象列を変えるdistancesの
  // 更新の間に別クライアントが矢を記録しないよう、Postgres関数
  // （update_distance）内で1つのトランザクションとして行う。
  const { error } = await supabase.rpc("update_distance", {
    p_distance_id: input.distanceId,
    p_distance: input.distance,
    p_total_ends: input.totalEnds,
    p_arrows_per_end: input.arrowsPerEnd,
    p_target_face_id: input.targetFaceId,
    p_is_marked: input.isMarked,
  });

  if (error) {
    return { error: error.message };
  }
}

export async function updateRoundConfig(input: {
  roundId: string;
  name: string;
  roundDate: string;
  format: string;
  bowType: string;
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  // Marked/Unmarkedはフィールドのみの概念のため、Unmarkedな距離（distanceが
  // 未入力のこともある）を残したまま他の種別に変更すると、距離が無いのに
  // 「距離」として扱われる不整合な状態が生まれてしまう。このチェックと
  // rounds更新の間に別クライアントの書き込みが割り込まないよう、Postgres
  // 関数（update_round_config）内で1つのトランザクションとして行う。
  const { error } = await supabase.rpc("update_round_config", {
    p_round_id: input.roundId,
    p_name: input.name,
    p_round_date: input.roundDate,
    p_format: input.format,
    p_bow_type: input.bowType,
  });

  if (error) {
    return { error: error.message };
  }
}

export async function saveRoundAsPreset(input: {
  roundId: string;
  name: string;
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  // ラウンド取得・距離取得・プリセット作成・距離複製を、Postgres関数
  // （save_round_as_preset）内で1つのトランザクションとして行う。距離の
  // insertが失敗しても、距離を持たない空のプリセットが残ることはない。
  const { error } = await supabase.rpc("save_round_as_preset", {
    p_round_id: input.roundId,
    p_name: input.name,
  });

  if (error) {
    return { error: error.message };
  }
}
