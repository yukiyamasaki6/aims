import type {
  DatabaseGateway,
  DbOrder,
  DbResponse,
} from "@/lib/supabase/contract/database";
import type { RoundQueries } from "../application/round-fetching";
import type { PresetRecord } from "../domain/preset";
import { newestById } from "../domain/round-base";
import type { ServerRoundSummary } from "../domain/round-list";
import type { ServerRound } from "../domain/round-tables";
import type { RoundStatus } from "../domain/sync-events";
import type { TargetFaceRecord } from "../domain/target-face";
import { failureOfResponses } from "./db-response-outcome";
import {
  ROUND_PRESET_SELECT,
  TARGET_FACE_SELECT,
} from "./reference-query-constants";
import type { RoundsDbSchema } from "./rounds-db-schema";

// 無効化した距離と取り消した矢の行も取得し、表示にはdisabled_atが無い行だけを使う。
const ROUND_SELECT =
  "id, name, round_date, format, bow_type, status, revision, distances(id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, revision, disabled_at, shots(id, distance_id, end_number, shooter_id, score_str, score_int, shot_number, revision, disabled_at))";

type ShotRow = {
  id: string;
  distance_id: string;
  end_number: number;
  shooter_id: string;
  score_str: string;
  score_int: number;
  shot_number: number | null;
  revision: number;
  disabled_at: string | null;
};

type DistanceRow = {
  id: string;
  position_key: string;
  distance: number | null;
  total_ends: number;
  arrows_per_end: number;
  target_face_id: string;
  is_marked: boolean;
  revision: number;
  disabled_at: string | null;
  shots: ShotRow[];
};

// 一覧は合計点を求めるため、距離と矢の削除の印と点だけを取得する。
const ROUNDS_LIST_SELECT =
  "id, name, round_date, distances(disabled_at, shots(score_int, disabled_at))";

type RoundSummaryRow = {
  id: string;
  name: string;
  round_date: string;
  distances: {
    disabled_at: string | null;
    shots: { score_int: number; disabled_at: string | null }[];
  }[];
};

type RoundRow = {
  id: string;
  name: string;
  round_date: string;
  format: string;
  bow_type: string;
  status: RoundStatus;
  revision: number;
  distances: DistanceRow[];
};

// 1回の取得に並べるラウンドIDの上限。IDはGETのURLに載るため、ゲートウェイが長いURLを414で拒まない件数に分ける。50件で約3KBで、ローカルで通ることを確かめた長さ(約3.7KB)に収まる。
const roundIdsPerRequest = 50;

function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += roundIdsPerRequest) {
    chunks.push(ids.slice(i, i + roundIdsPerRequest));
  }
  return chunks;
}

function toServerRound(row: RoundRow): ServerRound {
  return {
    id: row.id,
    roundConfig: {
      name: row.name,
      roundDate: row.round_date,
      format: row.format,
      bowType: row.bow_type,
    },
    status: row.status,
    revision: row.revision,
    distances: row.distances.map(({ shots, disabled_at, ...distance }) => ({
      ...distance,
      disabled: disabled_at !== null,
      shots: shots.map(({ disabled_at: shotDisabledAt, ...shot }) => ({
        ...shot,
        disabled: shotDisabledAt !== null,
      })),
    })),
  };
}

function toServerRoundSummary(row: RoundSummaryRow): ServerRoundSummary {
  return {
    id: row.id,
    name: row.name,
    roundDate: row.round_date,
    distances: row.distances.map((distance) => ({
      disabled: distance.disabled_at !== null,
      shots: distance.shots.map((shot) => ({
        score_int: shot.score_int,
        disabled: shot.disabled_at !== null,
      })),
    })),
  };
}

function toTargetFaces(rows: unknown): TargetFaceRecord[] {
  return (rows ?? []) as TargetFaceRecord[];
}

// preset_distances.target_facesはFKの多重度（多対1）上つねに単一のオブジェクトだが、
// 生成型は入れ子embedのカーディナリティを配列として広く推論するため、実体に合わせてキャストする。
function toPresets(rows: unknown): PresetRecord[] {
  return (rows ?? []) as PresetRecord[];
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 問い合わせの組み立てを閉じ込めるファクトリで、内側の関数は個々に上限内である。
export function createRoundQueries(
  database: DatabaseGateway<RoundsDbSchema>,
): RoundQueries {
  // target_facesのRLSは認証済みの全員に全行を見せるため、他人の個人の的を除くクエリの絞りが必須である。
  const selectTargetFaces = (userId: string) =>
    database.select({
      table: "target_faces",
      columns: TARGET_FACE_SELECT,
      filters: [
        { op: "or", expression: `owner_id.is.null,owner_id.eq.${userId}` },
      ],
    });

  const roundOrders: readonly DbOrder<RoundsDbSchema, "rounds">[] = [
    { column: "position_key", referencedTable: "distances" },
    { column: "id", referencedTable: "distances" },
  ];

  const listOrders: readonly DbOrder<RoundsDbSchema, "rounds">[] = [
    { column: "round_date", ascending: false },
  ];

  // 最初の取得は入力中のラウンドを含め、以降は入力中を除く(最初の取得で全件を得るため)。
  function selectRoundsChunk(
    chunk: readonly string[],
    index: number,
  ): Promise<DbResponse> {
    const notDisabled = {
      op: "is",
      column: "disabled_at",
      value: null,
    } as const;
    if (index > 0) {
      return database.select({
        table: "rounds",
        columns: ROUND_SELECT,
        filters: [
          notDisabled,
          { op: "neq", column: "status", value: "in_progress" },
          { op: "in", column: "id", values: chunk },
        ],
        orders: roundOrders,
      });
    }
    const filter = ["status.eq.in_progress"];
    if (chunk.length > 0) filter.push(`id.in.(${chunk.join(",")})`);
    return database.select({
      table: "rounds",
      columns: ROUND_SELECT,
      filters: [notDisabled, { op: "or", expression: filter.join(",") }],
      orders: roundOrders,
    });
  }

  return {
    async roundDetail(userId, roundId) {
      const [round, faces] = await Promise.all([
        database.select({
          table: "rounds",
          columns: ROUND_SELECT,
          filters: [
            { op: "eq", column: "id", value: roundId },
            { op: "is", column: "disabled_at", value: null },
          ],
          orders: roundOrders,
          single: "maybe",
        }),
        selectTargetFaces(userId),
      ]);
      const failure = failureOfResponses([round, faces]);
      if (failure) return failure;
      if (!round.data) return { status: "not-found" };
      return {
        status: "ok",
        data: {
          round: toServerRound(round.data as RoundRow),
          targetFaces: toTargetFaces(faces.data),
        },
      };
    },
    async roundDetails(userId, roundIds) {
      const chunks = roundIds.length > 0 ? chunkIds(roundIds) : [[]];
      const [faces, ...responses] = await Promise.all([
        selectTargetFaces(userId),
        ...chunks.map((chunk, index) => selectRoundsChunk(chunk, index)),
      ]);
      const failure = failureOfResponses([...responses, faces]);
      if (failure) return failure;
      const rows = responses.flatMap((r) => (r.data ?? []) as RoundRow[]);
      return {
        status: "ok",
        data: {
          rounds: newestById(rows).map(toServerRound),
          targetFaces: toTargetFaces(faces.data),
        },
      };
    },
    // 取得できる行はRLSでユーザーが属するラウンドに限るため、利用者で絞らない。
    async roundsList() {
      const response = await database.select({
        table: "rounds",
        columns: ROUNDS_LIST_SELECT,
        filters: [{ op: "is", column: "disabled_at", value: null }],
        orders: listOrders,
      });
      const failure = failureOfResponses([response]);
      if (failure) return failure;
      return {
        status: "ok",
        data: ((response.data ?? []) as RoundSummaryRow[]).map(
          toServerRoundSummary,
        ),
      };
    },
    async targetFaces(userId) {
      const faces = await selectTargetFaces(userId);
      const failure = failureOfResponses([faces]);
      if (failure) return failure;
      return { status: "ok", data: toTargetFaces(faces.data) };
    },
    // preset_roundsのRLSは認証済みの全員に全行を見せるため、他人の個人プリセットを除くクエリの絞りが必須である。
    async presets(userId) {
      const presets = await database.select({
        table: "preset_rounds",
        columns: ROUND_PRESET_SELECT,
        filters: [
          { op: "or", expression: `owner_id.is.null,owner_id.eq.${userId}` },
        ],
      });
      const failure = failureOfResponses([presets]);
      if (failure) return failure;
      return { status: "ok", data: toPresets(presets.data) };
    },
  };
}
