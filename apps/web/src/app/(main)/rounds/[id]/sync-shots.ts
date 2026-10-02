import { classifySession } from "@/features/auth/session-state";
import { createClient } from "@/lib/supabase/client";
import type { BatchResult } from "./sync-queue-types";
import { authFailureResult, rpcFailureResult } from "./sync-result";

// スコアの連打時に、記録・取り消しをそれぞれ1件ずつ送ると、通信本数分だけ
// 同期完了までの体感速度が悪化する。そのため、1回の呼び出しで複数件の記録・
// 取り消しをまとめて処理できるようにする（送信側の詰め方はuse-sync-queue.ts
// 参照）。
export async function syncShots(input: {
  upsert: {
    shotEventId: string;
    distanceId: string;
    endNumber: number;
    arrowNumber: number;
    scoreStr: string;
    scoreInt: number;
    shooterId?: string;
  }[];
  clear: {
    shotEventId: string;
    distanceId: string;
    endNumber: number;
    arrowNumber: number;
  }[];
}): Promise<BatchResult> {
  const supabase = createClient();

  const state = classifySession(await supabase.auth.getSession());
  if (state.status !== "authenticated") return authFailureResult(state);
  const user = state.session.user;

  if (input.upsert.length > 0) {
    const { error, status } = await supabase.rpc("record_shots", {
      p_shots: input.upsert.map((s) => ({
        shot_event_id: s.shotEventId,
        distance_id: s.distanceId,
        end_number: s.endNumber,
        arrow_number: s.arrowNumber,
        shooter_id: s.shooterId ?? user.id,
        score_str: s.scoreStr,
        score_int: s.scoreInt,
      })),
    });

    if (error) return rpcFailureResult(error, status);
  }

  if (input.clear.length > 0) {
    const { error, status } = await supabase.rpc("clear_shots", {
      p_shots: input.clear.map((c) => ({
        shot_event_id: c.shotEventId,
        distance_id: c.distanceId,
        end_number: c.endNumber,
        arrow_number: c.arrowNumber,
      })),
    });

    if (error) return rpcFailureResult(error, status);
  }
}
