"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function addDistance(input: {
  id: string;
  roundId: string;
  distanceNumber: number;
  distance: number | null;
  totalEnds: number;
  arrowsPerEnd: number;
  targetFaceId: string;
  isMarked: boolean;
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  // IDは楽観的UIのためクライアントで確定済みの値をそのまま使う
  // （id列のdefault gen_random_uuid()は明示的な値があれば上書きされる）。
  const { error } = await supabase.from("distances").insert({
    id: input.id,
    round_id: input.roundId,
    distance_number: input.distanceNumber,
    distance: input.distance,
    total_ends: input.totalEnds,
    arrows_per_end: input.arrowsPerEnd,
    target_face_id: input.targetFaceId,
    is_marked: input.isMarked,
  });

  if (error) {
    return { error: error.message };
  }
}

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

  const { count } = await supabase
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("distance_id", input.distanceId);

  // shotsが1件でも存在する距離は、総エンド数・エンドあたりの本数に加えて
  // 的（target_face_id）も変更させない。的の種類が変わると点数の意味も
  // 変わってしまい、既に記録済みのshotsと整合しなくなるため
  // （UI側でも読み取り専用にしているが、サーバー側でも防御的に無視する）。
  // distance・is_markedは点数構成に関係しないメタ情報なので、shots有無に
  // かかわらず常に変更できる。
  const hasShots = (count ?? 0) > 0;

  const { error } = await supabase
    .from("distances")
    .update(
      hasShots
        ? { distance: input.distance, is_marked: input.isMarked }
        : {
            distance: input.distance,
            total_ends: input.totalEnds,
            arrows_per_end: input.arrowsPerEnd,
            target_face_id: input.targetFaceId,
            is_marked: input.isMarked,
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  const { error } = await supabase
    .from("distances")
    .delete()
    .eq("id", input.distanceId);

  if (error) {
    return { error: error.message };
  }
}

// スコアの連打時に、記録・取り消しをそれぞれ1件ずつサーバーアクションと
// して送ると、Next.jsのServer Actionはクライアント側でどれだけ並列に
// 呼んでもサーバー側で直列にしか処理されないため、通信本数分だけ同期完了
// までの体感速度が悪化する。そのため、1回の呼び出しで複数件の記録・取り
// 消しをまとめて処理できるようにする（送信側の詰め方はuse-sync-queue.ts
// 参照）。
export async function syncShots(input: {
  upsert: {
    distanceId: string;
    endNumber: number;
    arrowNumber: number;
    scoreStr: string;
    scoreInt: number;
  }[];
  clear: { distanceId: string; endNumber: number; arrowNumber: number }[];
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  if (input.upsert.length > 0) {
    const { error } = await supabase.from("shots").upsert(
      input.upsert.map((s) => ({
        distance_id: s.distanceId,
        end_number: s.endNumber,
        arrow_number: s.arrowNumber,
        user_id: user.id,
        score_str: s.scoreStr,
        score_int: s.scoreInt,
      })),
      { onConflict: "distance_id,user_id,end_number,arrow_number" },
    );

    if (error) {
      return { error: error.message };
    }
  }

  if (input.clear.length > 0) {
    const filter = input.clear
      .map(
        (c) =>
          `and(distance_id.eq.${c.distanceId},end_number.eq.${c.endNumber},arrow_number.eq.${c.arrowNumber})`,
      )
      .join(",");

    const { error } = await supabase
      .from("shots")
      .delete()
      .eq("user_id", user.id)
      .or(filter);

    if (error) {
      return { error: error.message };
    }
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
  // 「距離」として扱われる不整合な状態が生まれてしまう。先に各距離を
  // Markedに戻してもらう。
  if (input.format !== "field") {
    const { count } = await supabase
      .from("distances")
      .select("id", { count: "exact", head: true })
      .eq("round_id", input.roundId)
      .eq("is_marked", false);

    if ((count ?? 0) > 0) {
      return {
        error:
          "Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。",
      };
    }
  }

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

  const { data: round, error: roundError } = await supabase
    .from("rounds")
    .select("format, bow_type")
    .eq("id", input.roundId)
    .single();

  if (roundError || !round) {
    return { error: roundError?.message ?? "ラウンドの取得に失敗しました。" };
  }

  const { data: distances, error: distancesError } = await supabase
    .from("distances")
    .select(
      "distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked",
    )
    .eq("round_id", input.roundId)
    .order("distance_number");

  if (distancesError) {
    return { error: distancesError.message };
  }

  const { data: preset, error: presetError } = await supabase
    .from("round_presets")
    .insert({
      owner_id: user.id,
      name: input.name,
      format: round.format,
      bow_type: round.bow_type,
    })
    .select("id")
    .single();

  if (presetError || !preset) {
    return {
      error: presetError?.message ?? "プリセットの保存に失敗しました。",
    };
  }

  const { error: presetDistancesError } = await supabase
    .from("round_preset_distances")
    .insert(
      (distances ?? []).map((d) => ({
        preset_id: preset.id,
        distance_number: d.distance_number,
        distance: d.distance,
        total_ends: d.total_ends,
        arrows_per_end: d.arrows_per_end,
        target_face_id: d.target_face_id,
        is_marked: d.is_marked,
      })),
    );

  if (presetDistancesError) {
    // 距離の登録に失敗した場合、距離を持たない空のプリセットだけが
    // 残らないよう削除する。
    await supabase.from("round_presets").delete().eq("id", preset.id);
    return { error: presetDistancesError.message };
  }
}

export async function deleteRound(input: {
  roundId: string;
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("rounds")
    .delete()
    .eq("id", input.roundId);

  if (error) {
    return { error: error.message };
  }

  redirect("/rounds");
}
