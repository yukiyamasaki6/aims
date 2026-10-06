import type { PostgrestError } from "@supabase/supabase-js";
import { classifySession } from "@/features/auth/session-state";
import type {
  OpFlight,
  OpResult,
  SendOutcome,
} from "@/features/op-log/op-log-types";
import {
  authFailureResult,
  rpcFailureResult,
} from "@/features/op-log/sync-result";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/supabase";
import type {
  DistanceChanges,
  RoundChanges,
  SyncOperation,
} from "./sync-events";

const INVALID_RESPONSE: SendOutcome = {
  ok: false,
  failure: {
    error: "サーバーの応答が不正です。",
    cause: { type: "exception" },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// RPCの結果(jsonb)を、操作ごとの判定結果へ写す。形が不正ならundefined。
function parseResult(data: unknown): OpResult | undefined {
  if (!isRecord(data) || typeof data.applied !== "boolean") return undefined;
  const { revision, applied_fields, rejected_fields, reason } = data;
  if (revision !== null && typeof revision !== "number") return undefined;
  const appliedFields =
    Array.isArray(applied_fields) &&
    applied_fields.every((f) => typeof f === "string")
      ? applied_fields
      : null;
  const rejectedFields: OpResult["rejectedFields"] = [];
  if (Array.isArray(rejected_fields)) {
    for (const item of rejected_fields) {
      if (
        !isRecord(item) ||
        typeof item.field !== "string" ||
        typeof item.reason !== "string"
      ) {
        return undefined;
      }
      rejectedFields.push({ field: item.field, reason: item.reason });
    }
  }
  return {
    revision: revision ?? null,
    applied: data.applied,
    appliedFields,
    rejectedFields,
    reason: typeof reason === "string" ? reason : null,
  };
}

function single(data: unknown): SendOutcome {
  const result = parseResult(data);
  return result ? { ok: true, results: [result] } : INVALID_RESPONSE;
}

function many(data: unknown, count: number): SendOutcome {
  if (!Array.isArray(data) || data.length !== count) return INVALID_RESPONSE;
  const results: OpResult[] = [];
  for (const item of data) {
    const result = parseResult(item);
    if (!result) return INVALID_RESPONSE;
    results.push(result);
  }
  return { ok: true, results };
}

// 数値(revision)だけを返すRPC。効かせる条件が無く、常に効く。
function revisionOnly(data: unknown): SendOutcome {
  return typeof data === "number"
    ? {
        ok: true,
        results: [
          {
            revision: data,
            applied: true,
            appliedFields: null,
            rejectedFields: [],
            reason: null,
          },
        ],
      }
    : INVALID_RESPONSE;
}

// `create_round`は旧版との互換のためラウンドIDを返す。作成のrevisionは常に1。
function createdOnly(data: unknown): SendOutcome {
  return typeof data === "string"
    ? {
        ok: true,
        results: [
          {
            revision: 1,
            applied: true,
            appliedFields: null,
            rejectedFields: [],
            reason: null,
          },
        ],
      }
    : INVALID_RESPONSE;
}

type Client = ReturnType<typeof createClient>;

type RpcResponse = {
  data: unknown;
  error: PostgrestError | null;
  status: number;
};

function outcomeOf(
  response: RpcResponse,
  parse: (data: unknown) => SendOutcome = single,
): SendOutcome {
  const { data, error, status } = response;
  if (error) return { ok: false, failure: rpcFailureResult(error, status) };
  return parse(data);
}

// 差分を、RPCのキー名(snake_case)の`p_changes`へ写す。値がundefinedの項目は送らない。
function roundChangesToJson(changes: RoundChanges): Json {
  const json: { [key: string]: Json } = {};
  if (changes.name !== undefined) json.name = changes.name;
  if (changes.roundDate !== undefined) json.round_date = changes.roundDate;
  if (changes.format !== undefined) json.format = changes.format;
  if (changes.bowType !== undefined) json.bow_type = changes.bowType;
  return json;
}

function distanceChangesToJson(changes: DistanceChanges): Json {
  const json: { [key: string]: Json } = {};
  // 距離(m)の未設定は、キーを送ってnullにする。
  if (changes.distance !== undefined) json.distance = changes.distance;
  if (changes.isMarked !== undefined) json.is_marked = changes.isMarked;
  if (changes.config) {
    json.config = {
      total_ends: changes.config.totalEnds,
      arrows_per_end: changes.config.arrowsPerEnd,
      target_face_id: changes.config.targetFaceId,
    };
  }
  return json;
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
    case "round.created":
      return outcomeOf(
        await supabase.rpc("create_round", {
          p_round_event_id: operation.eventId,
          p_id: operation.roundId,
          p_name: operation.name,
          p_round_date: operation.roundDate,
          p_format: operation.format,
          p_bow_type: operation.bowType,
          p_distances: operation.distances.map((d) => ({
            distance_event_id: d.eventId,
            id: d.id,
            position_key: d.positionKey,
            distance: d.distance,
            is_marked: d.isMarked,
            total_ends: d.totalEnds,
            arrows_per_end: d.arrowsPerEnd,
            target_face_id: d.targetFaceId,
          })),
        }),
        createdOnly,
      );
    case "round.updated":
      return outcomeOf(
        await supabase.rpc("update_round", {
          p_round_event_id: operation.eventId,
          p_round_id: operation.roundId,
          p_changes: roundChangesToJson(operation.changes),
        }),
      );
    case "round.disabled":
      return outcomeOf(
        await supabase.rpc("disable_round", {
          p_round_event_id: operation.eventId,
          p_round_id: operation.roundId,
        }),
        revisionOnly,
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
          p_changes: distanceChangesToJson(operation.changes),
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

// 要求の操作を、種類ごとのRPCで送る。サーバーの判定結果を、要求の操作と同じ順で返す。
// `expectedUserId`は列のユーザー。セッションのユーザーと違うときは未認証として保留する(別のユーザーの認証で送らないため)。nullの列は照合しない。
export async function sendRoundBatch(
  flight: OpFlight<SyncOperation>,
  expectedUserId: string | null,
): Promise<SendOutcome> {
  const supabase = createClient();
  const state = classifySession(await supabase.auth.getSession());
  if (state.status !== "authenticated") {
    return { ok: false, failure: authFailureResult(state) };
  }
  if (expectedUserId !== null && state.session.user.id !== expectedUserId) {
    return {
      ok: false,
      failure: authFailureResult({ status: "unauthenticated" }),
    };
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
