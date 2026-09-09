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
