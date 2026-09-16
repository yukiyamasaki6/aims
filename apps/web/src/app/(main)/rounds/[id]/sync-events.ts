import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

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

function toResult(error: PostgrestError | null) {
  if (!error) return undefined;
  return {
    error: error.message,
    // RPC内の業務ルール違反はRAISE EXCEPTION（P0001）、RLSによる拒否は
    // 42501になる。いずれも通信を再試行しても解消しない。
    permanent: error.code === "P0001" || error.code === "42501",
  };
}

export async function executeSyncOperation(
  operation: SyncOperation,
): Promise<{ error: string; permanent?: boolean } | undefined> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return { error: "サインインが必要です。", permanent: true };

  switch (operation.type) {
    case "round.updated": {
      const { error } = await supabase.rpc("update_round", {
        p_round_event_id: operation.eventId,
        p_round_id: operation.roundId,
        p_name: operation.name,
        p_round_date: operation.roundDate,
        p_format: operation.format,
        p_bow_type: operation.bowType,
      });
      return toResult(error);
    }
    case "round.disabled": {
      const { error } = await supabase.rpc("disable_round", {
        p_round_event_id: operation.eventId,
        p_round_id: operation.roundId,
      });
      return toResult(error);
    }
    case "distance.created": {
      const { error } = await supabase.rpc("create_distance", {
        p_distance_event_id: operation.eventId,
        p_id: operation.id,
        p_round_id: operation.roundId,
        p_position_key: operation.positionKey,
        p_distance: operation.distance,
        p_total_ends: operation.totalEnds,
        p_arrows_per_end: operation.arrowsPerEnd,
        p_target_face_id: operation.targetFaceId,
        p_is_marked: operation.isMarked,
      });
      return toResult(error);
    }
    case "distance.updated": {
      const { error } = await supabase.rpc("update_distance", {
        p_distance_event_id: operation.eventId,
        p_distance_id: operation.distanceId,
        p_distance: operation.distance,
        p_total_ends: operation.totalEnds,
        p_arrows_per_end: operation.arrowsPerEnd,
        p_target_face_id: operation.targetFaceId,
        p_is_marked: operation.isMarked,
      });
      return toResult(error);
    }
    case "distance.disabled": {
      const { error } = await supabase.rpc("disable_distance", {
        p_distance_event_id: operation.eventId,
        p_distance_id: operation.distanceId,
      });
      return toResult(error);
    }
    case "shot.recorded": {
      const { error } = await supabase.rpc("record_shots", {
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
      return toResult(error);
    }
    case "shot.cleared": {
      const { error } = await supabase.rpc("clear_shots", {
        p_shots: [
          {
            shot_event_id: operation.eventId,
            distance_id: operation.distanceId,
            end_number: operation.endNumber,
            arrow_number: operation.arrowNumber,
          },
        ],
      });
      return toResult(error);
    }
  }
}
