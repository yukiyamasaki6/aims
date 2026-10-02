import { classifySession } from "@/features/auth/session-state";
import { createClient } from "@/lib/supabase/client";
import type { BatchResult } from "./sync-queue-types";
import { authFailureResult, rpcFailureResult } from "./sync-result";

export type SyncOperation =
  | {
      type: "round.updated";
      eventId: string;
      roundId: string;
      name: string;
      roundDate: string;
      format: string;
      bowType: string;
    }
  | { type: "round.disabled"; eventId: string; roundId: string }
  | {
      type: "distance.created";
      eventId: string;
      id: string;
      roundId: string;
      positionKey: string;
      distance: number | null;
      totalEnds: number;
      arrowsPerEnd: number;
      targetFaceId: string;
      isMarked: boolean;
    }
  | {
      type: "distance.updated";
      eventId: string;
      distanceId: string;
      distance: number | null;
      totalEnds: number;
      arrowsPerEnd: number;
      targetFaceId: string;
      isMarked: boolean;
    }
  | { type: "distance.disabled"; eventId: string; distanceId: string }
  | {
      type: "shot.recorded";
      eventId: string;
      distanceId: string;
      endNumber: number;
      arrowNumber: number;
      scoreStr: string;
      scoreInt: number;
      shooterId?: string;
    }
  | {
      type: "shot.cleared";
      eventId: string;
      distanceId: string;
      endNumber: number;
      arrowNumber: number;
    };

export function eventIdOf(operation: SyncOperation): string {
  return operation.eventId;
}

export async function executeSyncOperation(
  operation: SyncOperation,
): Promise<BatchResult> {
  const supabase = createClient();
  const state = classifySession(await supabase.auth.getSession());
  if (state.status !== "authenticated") return authFailureResult(state);
  const user = state.session.user;

  switch (operation.type) {
    case "round.updated": {
      const { error, status } = await supabase.rpc("update_round", {
        p_round_event_id: operation.eventId,
        p_round_id: operation.roundId,
        p_name: operation.name,
        p_round_date: operation.roundDate,
        p_format: operation.format,
        p_bow_type: operation.bowType,
      });
      if (error) return rpcFailureResult(error, status);
      return undefined;
    }
    case "round.disabled": {
      const { error, status } = await supabase.rpc("disable_round", {
        p_round_event_id: operation.eventId,
        p_round_id: operation.roundId,
      });
      if (error) return rpcFailureResult(error, status);
      return undefined;
    }
    case "distance.created": {
      const { error, status } = await supabase.rpc("create_distance", {
        p_distance_event_id: operation.eventId,
        p_id: operation.id,
        p_round_id: operation.roundId,
        p_position_key: operation.positionKey,
        // 生成型はRPCの引数をnon-nullで出力するが、distanceはSQL側でnullを受け付ける。
        p_distance: operation.distance as number,
        p_total_ends: operation.totalEnds,
        p_arrows_per_end: operation.arrowsPerEnd,
        p_target_face_id: operation.targetFaceId,
        p_is_marked: operation.isMarked,
      });
      if (error) return rpcFailureResult(error, status);
      return undefined;
    }
    case "distance.updated": {
      const { error, status } = await supabase.rpc("update_distance", {
        p_distance_event_id: operation.eventId,
        p_distance_id: operation.distanceId,
        // 生成型はRPCの引数をnon-nullで出力するが、distanceはSQL側でnullを受け付ける。
        p_distance: operation.distance as number,
        p_total_ends: operation.totalEnds,
        p_arrows_per_end: operation.arrowsPerEnd,
        p_target_face_id: operation.targetFaceId,
        p_is_marked: operation.isMarked,
      });
      if (error) return rpcFailureResult(error, status);
      return undefined;
    }
    case "distance.disabled": {
      const { error, status } = await supabase.rpc("disable_distance", {
        p_distance_event_id: operation.eventId,
        p_distance_id: operation.distanceId,
      });
      if (error) return rpcFailureResult(error, status);
      return undefined;
    }
    case "shot.recorded": {
      const { error, status } = await supabase.rpc("record_shots", {
        p_shots: [
          {
            shot_event_id: operation.eventId,
            distance_id: operation.distanceId,
            end_number: operation.endNumber,
            arrow_number: operation.arrowNumber,
            shooter_id: operation.shooterId ?? user.id,
            score_str: operation.scoreStr,
            score_int: operation.scoreInt,
          },
        ],
      });
      if (error) return rpcFailureResult(error, status);
      return undefined;
    }
    case "shot.cleared": {
      const { error, status } = await supabase.rpc("clear_shots", {
        p_shots: [
          {
            shot_event_id: operation.eventId,
            distance_id: operation.distanceId,
            end_number: operation.endNumber,
            arrow_number: operation.arrowNumber,
          },
        ],
      });
      if (error) return rpcFailureResult(error, status);
      return undefined;
    }
  }
}
