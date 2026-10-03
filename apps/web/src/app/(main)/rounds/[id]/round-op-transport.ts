import type { PostgrestError } from "@supabase/supabase-js";
import { classifySession } from "@/features/auth/session-state";
import type { OpFlight, SendOutcome } from "@/features/op-log/op-log-types";
import {
  authFailureResult,
  rpcFailureResult,
} from "@/features/op-log/sync-result";
import { createClient } from "@/lib/supabase/client";
import type { SyncOperation } from "./sync-events";

const INVALID_RESPONSE: SendOutcome = {
  ok: false,
  failure: {
    error: "サーバーの応答が不正です。",
    cause: { type: "exception" },
  },
};

function single(data: unknown): SendOutcome {
  return typeof data === "number"
    ? { ok: true, revisions: [data] }
    : INVALID_RESPONSE;
}

function many(data: unknown, count: number): SendOutcome {
  return Array.isArray(data) &&
    data.length === count &&
    data.every((revision) => typeof revision === "number")
    ? { ok: true, revisions: data }
    : INVALID_RESPONSE;
}

type Client = ReturnType<typeof createClient>;

type RpcResponse = {
  data: unknown;
  error: PostgrestError | null;
  status: number;
};

function outcomeOf(response: RpcResponse): SendOutcome {
  const { data, error, status } = response;
  if (error) return { ok: false, failure: rpcFailureResult(error, status) };
  return single(data);
}

type ShotOperation = Extract<
  SyncOperation,
  { type: "shot.recorded" | "shot.cleared" }
>;

async function sendSingle(
  supabase: Client,
  operation: SyncOperation,
  userId: string,
): Promise<SendOutcome> {
  switch (operation.type) {
    case "round.updated":
      return outcomeOf(
        await supabase.rpc("update_round", {
          p_round_event_id: operation.eventId,
          p_round_id: operation.roundId,
          p_name: operation.name,
          p_round_date: operation.roundDate,
          p_format: operation.format,
          p_bow_type: operation.bowType,
        }),
      );
    case "round.disabled":
      return outcomeOf(
        await supabase.rpc("disable_round", {
          p_round_event_id: operation.eventId,
          p_round_id: operation.roundId,
        }),
      );
    case "distance.created":
      return outcomeOf(
        await supabase.rpc("create_distance", {
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
        }),
      );
    case "distance.updated":
      return outcomeOf(
        await supabase.rpc("update_distance", {
          p_distance_event_id: operation.eventId,
          p_distance_id: operation.distanceId,
          // 生成型はRPCの引数をnon-nullで出力するが、distanceはSQL側でnullを受け付ける。
          p_distance: operation.distance as number,
          p_total_ends: operation.totalEnds,
          p_arrows_per_end: operation.arrowsPerEnd,
          p_target_face_id: operation.targetFaceId,
          p_is_marked: operation.isMarked,
        }),
      );
    case "distance.disabled":
      return outcomeOf(
        await supabase.rpc("disable_distance", {
          p_distance_event_id: operation.eventId,
          p_distance_id: operation.distanceId,
        }),
      );
    case "shot.recorded":
    case "shot.cleared":
      return sendShots(supabase, [operation], userId);
  }
}

// 矢の記録と取り消しの束は、列の順で1本のRPCへ詰める。planFlightsは、記録と取り消しを同じ要求に混ぜない。
async function sendShots(
  supabase: Client,
  operations: ShotOperation[],
  userId: string,
): Promise<SendOutcome> {
  const recorded = operations.filter((op) => op.type === "shot.recorded");
  if (recorded.length === operations.length) {
    const { data, error, status } = await supabase.rpc("record_shots", {
      p_shots: recorded.map((operation) => ({
        shot_event_id: operation.eventId,
        distance_id: operation.distanceId,
        end_number: operation.endNumber,
        arrow_number: operation.arrowNumber,
        shooter_id: operation.shooterId ?? userId,
        score_str: operation.scoreStr,
        score_int: operation.scoreInt,
      })),
    });
    if (error) return { ok: false, failure: rpcFailureResult(error, status) };
    return many(data, recorded.length);
  }
  const { data, error, status } = await supabase.rpc("clear_shots", {
    p_shots: operations.map((operation) => ({
      shot_event_id: operation.eventId,
      distance_id: operation.distanceId,
      end_number: operation.endNumber,
      arrow_number: operation.arrowNumber,
    })),
  });
  if (error) return { ok: false, failure: rpcFailureResult(error, status) };
  return many(data, operations.length);
}

// 要求の操作を、種類ごとの既存のRPCで送る。確定したrevisionを、要求の操作と同じ順で返す。
export async function sendRoundBatch(
  flight: OpFlight<SyncOperation>,
): Promise<SendOutcome> {
  const supabase = createClient();
  const state = classifySession(await supabase.auth.getSession());
  if (state.status !== "authenticated") {
    return { ok: false, failure: authFailureResult(state) };
  }
  const userId = state.session.user.id;
  const shots: ShotOperation[] = [];
  for (const { operation } of flight.entries) {
    if (
      operation.type === "shot.recorded" ||
      operation.type === "shot.cleared"
    ) {
      shots.push(operation);
    }
  }
  if (shots.length > 1) return sendShots(supabase, shots, userId);
  // 矢の束以外は、planFlightsが1件ずつの要求にする。
  return sendSingle(supabase, flight.entries[0].operation, userId);
}
