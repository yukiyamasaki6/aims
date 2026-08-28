"use server";

import { createClient } from "@/lib/supabase/server";

// 10点的（アウトドア・122cm）。距離追加時の初期的として使う（e2eのcreate-round
// APIヘルパーが使う既定の的と同じもの）。
const DEFAULT_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001";

export async function addDistance(input: { roundId: string }): Promise<
  | {
      distance: {
        id: string;
        distanceNumber: number;
        distance: number;
        totalEnds: number;
        arrowsPerEnd: number;
        targetFaceId: string;
      };
    }
  | { error: string }
> {
  const supabase = await createClient();

  // 直前（一番大きいdistance_number）の距離の内容をそのまま初期値として引き継ぐ。
  // 距離が1件も無い場合のみ、決め打ちの初期値にフォールバックする。
  const { data: last, error: fetchError } = await supabase
    .from("distances")
    .select(
      "distance_number, distance, total_ends, arrows_per_end, target_face_id",
    )
    .eq("round_id", input.roundId)
    .order("distance_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    return { error: fetchError.message };
  }

  const nextNumber = (last?.distance_number ?? 0) + 1;

  const { data, error } = await supabase
    .from("distances")
    .insert({
      round_id: input.roundId,
      distance_number: nextNumber,
      distance: last?.distance ?? 18,
      total_ends: last?.total_ends ?? 6,
      arrows_per_end: last?.arrows_per_end ?? 6,
      target_face_id: last?.target_face_id ?? DEFAULT_TARGET_FACE_ID,
    })
    .select(
      "id, distance_number, distance, total_ends, arrows_per_end, target_face_id",
    )
    .single();

  if (error || !data) {
    return { error: error?.message ?? "距離の追加に失敗しました。" };
  }

  return {
    distance: {
      id: data.id,
      distanceNumber: data.distance_number,
      distance: data.distance,
      totalEnds: data.total_ends,
      arrowsPerEnd: data.arrows_per_end,
      targetFaceId: data.target_face_id,
    },
  };
}

export async function updateDistance(input: {
  distanceId: string;
  distance: number;
  totalEnds: number;
  arrowsPerEnd: number;
  targetFaceId: string;
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("distance_id", input.distanceId);

  // shotsが1件でも存在する距離は、総エンド数・エンドあたりの本数に加えて
  // 的（target_face_id）も変更させない。的の種類が変わると点数の意味も
  // 変わってしまい、既に記録済みのshotsと整合しなくなるため
  // （UI側でも読み取り専用にしているが、サーバー側でも防御的に無視する）。
  const hasShots = (count ?? 0) > 0;

  const { error } = await supabase
    .from("distances")
    .update(
      hasShots
        ? { distance: input.distance }
        : {
            distance: input.distance,
            total_ends: input.totalEnds,
            arrows_per_end: input.arrowsPerEnd,
            target_face_id: input.targetFaceId,
          },
    )
    .eq("id", input.distanceId);

  if (error) {
    return { error: error.message };
  }
}

export async function deleteDistance(input: {
  distanceId: string;
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("distances")
    .delete()
    .eq("id", input.distanceId);

  if (error) {
    return { error: error.message };
  }
}

export async function recordShot(input: {
  distanceId: string;
  endNumber: number;
  arrowNumber: number;
  scoreStr: string;
  scoreInt: number;
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  const { error } = await supabase.from("shots").upsert(
    {
      distance_id: input.distanceId,
      end_number: input.endNumber,
      arrow_number: input.arrowNumber,
      user_id: user.id,
      score_str: input.scoreStr,
      score_int: input.scoreInt,
    },
    { onConflict: "distance_id,user_id,end_number,arrow_number" },
  );

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

  const { error } = await supabase
    .from("rounds")
    .update({
      name: input.name,
      round_date: input.roundDate,
      format: input.format,
      bow_type: input.bowType,
    })
    .eq("id", input.roundId);

  if (error) {
    return { error: error.message };
  }
}

export async function clearShot(input: {
  distanceId: string;
  endNumber: number;
  arrowNumber: number;
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  const { error } = await supabase.from("shots").delete().match({
    distance_id: input.distanceId,
    end_number: input.endNumber,
    arrow_number: input.arrowNumber,
    user_id: user.id,
  });

  if (error) {
    return { error: error.message };
  }
}
