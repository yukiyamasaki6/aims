import { createClient } from "@/lib/supabase/client";

// スコアの連打時に、記録・取り消しをそれぞれ1件ずつ送ると、通信本数分だけ
// 同期完了までの体感速度が悪化する。そのため、1回の呼び出しで複数件の記録・
// 取り消しをまとめて処理できるようにする（送信側の詰め方はuse-sync-queue.ts
// 参照）。
export async function syncShots(input: {
  upsert: {
    distanceId: string;
    endNumber: number;
    arrowNumber: number;
    scoreStr: string;
    scoreInt: number;
    shooterId?: string;
  }[];
  clear: { distanceId: string; endNumber: number; arrowNumber: number }[];
}): Promise<{ error: string } | undefined> {
  const supabase = createClient();

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
        shooter_id: s.shooterId ?? user.id,
        score_str: s.scoreStr,
        score_int: s.scoreInt,
      })),
      { onConflict: "distance_id,end_number,arrow_number" },
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

    const { error } = await supabase.from("shots").delete().or(filter);

    if (error) {
      return { error: error.message };
    }
  }
}
