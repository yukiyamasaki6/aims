import { describe, expect, it } from "vitest";
import type {
  DatabaseGateway,
  DbResponse,
  DbSelect,
} from "@/lib/supabase/contract/database";
import {
  DEFAULT_HISTORY_CONDITION,
  type HistoryCondition,
} from "../domain/history-view-state";
import type { QueryOutcome } from "../domain/query-outcome";
import { ROUND_PRESET_SELECT } from "./reference-query-constants";
import { createRoundQueries } from "./round-queries";
import type { RoundsDbSchema } from "./rounds-db-schema";

// 問い合わせの値が検証対象で、表の名前の型引数は区別しない。
type Query = DbSelect<
  RoundsDbSchema,
  "rounds" | "distances" | "target_faces" | "preset_rounds"
>;

const listRequest = {
  condition: DEFAULT_HISTORY_CONDITION,
  after: null,
  size: 10,
};

const ok = (data: unknown): DbResponse => ({ data, error: null, status: 200 });
const failed = (
  status: number,
  error: DbResponse["error"] = null,
): DbResponse => ({
  data: null,
  error,
  status,
});

// 成功した結果のデータ。成功でなければundefined。
function dataOf<T>(outcome: QueryOutcome<T>): T | undefined {
  return outcome.status === "ok" ? outcome.data : undefined;
}

type Responses = {
  rounds: DbResponse | ((roundsQueryIndex: number) => DbResponse);
  target_faces: DbResponse;
  preset_rounds?: DbResponse;
  rounds_list?: DbResponse;
  distances_list?: DbResponse;
};

// データベースの境界を、表ごとの応答を返し、受けた問い合わせを記録するゲートウェイで模す。
function makeDatabase(responses: Responses) {
  const queries: Query[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let roundsCount = 0;
  const database: DatabaseGateway<RoundsDbSchema> = {
    async select(query) {
      queries.push(query as unknown as Query);
      if (query.table === "target_faces") return responses.target_faces;
      if (query.table === "preset_rounds") {
        return responses.preset_rounds ?? ok(null);
      }
      const source = responses.rounds;
      return typeof source === "function" ? source(roundsCount++) : source;
    },
    async delete() {
      throw new Error("取得は削除を使わない");
    },
    async rpc(name, args) {
      if (name !== "rounds_list" && name !== "distances_list")
        throw new Error("取得は履歴以外のRPCを使わない");
      rpcCalls.push({ name, args: args as Record<string, unknown> });
      // 応答の型は呼び出しごとの生成型で、ここでは値だけを返す。
      if (name === "distances_list") {
        return (responses.distances_list ??
          ok({ distances: [], has_more: false })) as never;
      }
      return (responses.rounds_list ??
        ok({ rounds: [], has_more: false })) as never;
    },
  };
  return {
    queries,
    rpcCalls,
    queries_of: (table: string) => queries.filter((q) => q.table === table),
    createQueries: () => createRoundQueries(database),
  };
}

const distanceA = {
  id: "d-a",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
};
const shotA = {
  id: "s-a",
  distance_id: "d-a",
  end_number: 1,
  shooter_id: "user-1",
  score_str: "X",
  score_int: 10,
  shot_number: null,
};

const round = {
  id: "round-1",
  name: "午前練習",
  round_date: "2026-09-15",
  format: "outdoor",
  bow_type: "recurve",
  status: "completed",
  revision: 3,
  distances: [
    {
      ...distanceA,
      revision: 4,
      disabled_at: null,
      shots: [{ ...shotA, revision: 5, disabled_at: null }],
    },
  ],
};

function face(id: string, ownerId: string | null) {
  return {
    id,
    name: id,
    size: 122,
    format: "outdoor",
    bow_type: ["recurve"],
    owner_id: ownerId,
    target_face_spots: [],
  };
}

describe("roundDetail", () => {
  it("ラウンド(距離・記録を含む)だけを1回取得する", async () => {
    // Given
    const database = makeDatabase({ rounds: ok(round), target_faces: ok([]) });

    // When
    await database.createQueries().roundDetail("round-1");

    // Then
    // 論理削除された距離・記録は、revisionの判定に使うため取得する。
    expect(database.queries).toEqual([
      {
        table: "rounds",
        columns:
          "id, name, round_date, format, bow_type, status, revision, distances(id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, revision, disabled_at, shots(id, distance_id, end_number, shooter_id, score_str, score_int, shot_number, revision, disabled_at))",
        filters: [
          { op: "eq", column: "id", value: "round-1" },
          { op: "is", column: "disabled_at", value: null },
        ],
        orders: [
          { column: "position_key", referencedTable: "distances" },
          { column: "id", referencedTable: "distances" },
        ],
        single: "maybe",
        retry: true,
      },
    ]);
  });

  it("ラウンドの行を写さずにそのまま返す", async () => {
    // Given
    const disabledAt = "2026-09-16T00:00:00Z";
    const row = {
      ...round,
      distances: [
        {
          ...round.distances[0],
          shots: [{ ...shotA, revision: 8, disabled_at: disabledAt }],
        },
      ],
    };
    const database = makeDatabase({
      rounds: ok(row),
      target_faces: ok([]),
    });

    // When
    const response = await database.createQueries().roundDetail("round-1");

    // Then
    expect(response).toEqual({ status: "ok", data: row });
  });

  it("ラウンドがnullならnot-foundにする", async () => {
    // Given
    const missing = makeDatabase({ rounds: ok(null), target_faces: ok([]) });

    // When
    const notFound = await missing.createQueries().roundDetail("r");

    // Then
    expect(notFound).toEqual({ status: "not-found" });
  });

  it("通信失敗(status 0)はcomm-failure、401はauth-rejected、サーバーエラーはfailedにする", async () => {
    // Given
    const jwt = { code: "PGRST301", message: "jwt" };
    const comm = makeDatabase({ rounds: failed(0), target_faces: ok([]) });
    const rejected = makeDatabase({
      rounds: failed(401, jwt),
      target_faces: ok([]),
    });
    const errored = makeDatabase({
      rounds: failed(500, { message: "round" }),
      target_faces: ok([]),
    });

    // When
    const first = await comm.createQueries().roundDetail("r");
    const second = await rejected.createQueries().roundDetail("r");
    const third = await errored.createQueries().roundDetail("r");

    // Then
    expect(first).toEqual({ status: "comm-failure" });
    expect(second).toEqual({ status: "auth-rejected" });
    expect(third).toEqual({ status: "failed" });
  });
});

describe("再試行の指定", () => {
  it("個別の取得と一括の取得は、ラウンドの全てのselectと一括の取得の的のselectにretry: trueを付ける", async () => {
    // Given
    const detailDatabase = makeDatabase({
      rounds: ok(round),
      target_faces: ok([]),
    });
    const batchDatabase = makeDatabase({
      rounds: ok([]),
      target_faces: ok([]),
    });
    const ids = Array.from({ length: 120 }, (_, i) => `id-${i}`);

    // When
    await detailDatabase.createQueries().roundDetail("round-1");
    await batchDatabase.createQueries().roundDetails("user-1", ids);

    // Then
    const retries = [...detailDatabase.queries, ...batchDatabase.queries].map(
      (query) => query.retry,
    );
    expect(retries.length).toBeGreaterThan(4);
    expect(retries.every((retry) => retry === true)).toBe(true);
  });

  it("プリセットの取得はretryを付けない", async () => {
    // Given
    const database = makeDatabase({
      rounds: ok([]),
      target_faces: ok([]),
      preset_rounds: ok([]),
    });
    const queries = database.createQueries();

    // When
    await queries.presets("user-1");
    await queries.roundsList(listRequest);

    // Then
    expect(database.queries.length).toBe(1);
    expect(database.queries.map((query) => query.retry)).toEqual([undefined]);
  });
});

describe("roundDetails", () => {
  const uuid1 = "11111111-1111-4111-8111-111111111111";
  const uuid2 = "22222222-2222-4222-8222-222222222222";
  const uuidAt = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const uuids = (count: number) =>
    Array.from({ length: count }, (_, i) => uuidAt(i + 1));

  // 取得に並べたIDを、絞りの種類によらず取り出す。
  function idsOf(query: Query): string[] {
    const inFilter = query.filters?.find((f) => f.op === "in");
    if (inFilter?.op === "in") return [...inFilter.values];
    const orFilter = query.filters?.find((f) => f.op === "or");
    const listed =
      orFilter?.op === "or"
        ? orFilter.expression.split("id.in.(")[1]
        : undefined;
    return listed ? listed.replace(")", "").split(",") : [];
  }

  it("入力中のラウンドと指定したラウンドを1回の取得で得る", async () => {
    // Given
    const database = makeDatabase({
      rounds: ok([
        { ...round, id: uuid1, status: "in_progress" },
        { ...round, id: uuid2 },
      ]),
      target_faces: ok([face("face-1", null)]),
    });

    // When
    const response = await database
      .createQueries()
      .roundDetails("user-1", [uuid2]);

    // Then
    const [query] = database.queries_of("rounds");
    expect(query.filters).toEqual([
      { op: "is", column: "disabled_at", value: null },
      { op: "or", expression: `status.eq.in_progress,id.in.(${uuid2})` },
    ]);
    expect(dataOf(response)?.rounds.map((r) => r.id)).toEqual([uuid1, uuid2]);
    expect(dataOf(response)?.targetFaces).toEqual([face("face-1", null)]);
    expect(database.queries_of("target_faces")[0].filters).toEqual([
      { op: "or", expression: "owner_id.is.null,owner_id.eq.user-1" },
    ]);
  });

  it("指定したラウンドが無ければ、入力中のラウンドだけで絞る", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: ok([]) });

    // When
    await database.createQueries().roundDetails("user-1", []);

    // Then
    expect(database.queries_of("rounds")[0].filters).toContainEqual({
      op: "or",
      expression: "status.eq.in_progress",
    });
  });

  it("50件までは1回の取得で、51件目から取得が増え、2回目以降は入力中を除く", async () => {
    // Given
    const counts: Record<number, Query[]> = {};

    // When
    for (const n of [0, 50, 51]) {
      const database = makeDatabase({ rounds: ok([]), target_faces: ok([]) });
      await database.createQueries().roundDetails("user-1", uuids(n));
      counts[n] = database.queries_of("rounds");
    }

    // Then
    expect([0, 50, 51].map((n) => counts[n].length)).toEqual([1, 1, 2]);
    expect(counts[50][0].filters).toContainEqual({
      op: "or",
      expression: `status.eq.in_progress,id.in.(${uuids(50).join(",")})`,
    });
    expect(counts[51][1].filters).toEqual([
      { op: "is", column: "disabled_at", value: null },
      { op: "neq", column: "status", value: "in_progress" },
      { op: "in", column: "id", values: [uuidAt(51)] },
    ]);
  });

  it("300件では、取得が6回に分かれ、各取得のIDは50件以下で文字列が確認済みの長さを下回り、全IDが重複なく1回ずつ含まれる", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: ok([]) });
    const all = uuids(300);

    // When
    await database.createQueries().roundDetails("user-1", all);

    // Then
    const sent = database.queries_of("rounds").map(idsOf);
    expect(sent).toHaveLength(6);
    for (const ids of sent) {
      expect(ids.length).toBeLessThanOrEqual(50);
      // 3755バイトは、ゲートウェイが通すことを確かめた長さ。
      expect(encodeURIComponent(ids.join(",")).length).toBeLessThan(3755);
    }
    expect(sent.flat()).toEqual(all);
  });

  it("複数の取得の行を1つにまとめ、同じIDはrevisionが大きい行を使う", async () => {
    // Given
    const dup = uuidAt(51);
    const database = makeDatabase({
      rounds: (index) =>
        index === 0
          ? ok([
              { ...round, id: uuidAt(1), status: "in_progress" },
              { ...round, id: dup, revision: 3 },
            ])
          : ok([{ ...round, id: dup, revision: 9 }]),
      target_faces: ok([]),
    });

    // When
    const response = await database
      .createQueries()
      .roundDetails("user-1", uuids(51));

    // Then
    expect(dataOf(response)?.rounds.map((r) => [r.id, r.revision])).toEqual([
      [uuidAt(1), 3],
      [dup, 9],
    ]);
  });

  it("取得の1つでも失敗したら、全体を失敗とする(2回目以降を含む)", async () => {
    // Given
    const comm = makeDatabase({
      rounds: (index) => (index === 1 ? failed(0) : ok([])),
      target_faces: ok([face("face-1", null)]),
    });
    const server = makeDatabase({
      rounds: (index) => (index === 2 ? failed(500, { message: "x" }) : ok([])),
      target_faces: ok([]),
    });

    // When
    const first = await comm.createQueries().roundDetails("u", uuids(51));
    const second = await server.createQueries().roundDetails("u", uuids(120));

    // Then
    expect(first).toEqual({ status: "comm-failure" });
    expect(second).toEqual({ status: "failed" });
  });
});

describe("targetFaces", () => {
  it("公式と自分の的だけを、ラウンドを取得せずに1回の問い合わせで得る", async () => {
    // Given
    const database = makeDatabase({
      rounds: ok([]),
      target_faces: ok([face("face-1", null), face("face-2", "user-1")]),
    });

    // When
    const response = await database.createQueries().targetFaces("user-1");

    // Then
    expect(database.queries_of("rounds")).toEqual([]);
    expect(database.queries_of("target_faces")[0].filters).toEqual([
      { op: "or", expression: "owner_id.is.null,owner_id.eq.user-1" },
    ]);
    expect(dataOf(response)?.map((item) => item.id)).toEqual([
      "face-1",
      "face-2",
    ]);
  });

  it("通信失敗(status 0)はcomm-failure、エラー応答はfailedの種類で返す", async () => {
    // Given
    const comm = makeDatabase({ rounds: ok([]), target_faces: failed(0) });
    const server = makeDatabase({
      rounds: ok([]),
      target_faces: failed(500, { message: "x" }),
    });

    // When
    const first = await comm.createQueries().targetFaces("u");
    const second = await server.createQueries().targetFaces("u");

    // Then
    expect(first).toEqual({ status: "comm-failure" });
    expect(second).toEqual({ status: "failed" });
  });
});

describe("roundsList", () => {
  const noFaces = ok(null);
  const condition: HistoryCondition = {
    unit: "round",
    sortKey: "score",
    sortDirection: "asc",
    format: "indoor",
    bowType: "compound",
    dateFrom: "2026-05-01",
    dateTo: "2026-05-31",
    scoreMin: 0,
    scoreMax: 600,
    distances: [],
    distanceRow: null,
  };
  const request = { condition, after: "round-9", size: 25 };

  it("条件(基準・向き・種別・弓種・期間・得点の範囲)、続きの起点、件数を、履歴の関数(rounds_list)の引数に写して1回呼ぶ", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });

    // When
    await database.createQueries().roundsList(request);

    // Then
    expect(database.queries).toHaveLength(0);
    expect(database.rpcCalls).toEqual([
      {
        name: "rounds_list",
        args: {
          p_sort_key: "score",
          p_sort_direction: "asc",
          p_format: "indoor",
          p_bow_type: "compound",
          p_after_id: "round-9",
          p_limit: 25,
          p_date_from: "2026-05-01",
          p_date_to: "2026-05-31",
          p_score_min: 0,
          p_score_max: 600,
        },
      },
    ]);
  });

  it("期間・得点の範囲・距離の構成の指定が全くなければ、5引数を含めず、旧い版と同じ6引数で呼ぶ", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });

    // When
    await database.createQueries().roundsList(listRequest);

    // Then
    expect(Object.keys(database.rpcCalls[0]?.args ?? {}).sort()).toEqual([
      "p_after_id",
      "p_bow_type",
      "p_format",
      "p_limit",
      "p_sort_direction",
      "p_sort_key",
    ]);
  });

  it.each([
    ["開始日だけ", { dateFrom: "2026-05-01" }, { p_date_from: "2026-05-01" }],
    ["終了日だけ", { dateTo: "2026-05-31" }, { p_date_to: "2026-05-31" }],
    ["下限だけ(0を含む)", { scoreMin: 0 }, { p_score_min: 0 }],
    ["上限だけ", { scoreMax: 600 }, { p_score_max: 600 }],
  ])(
    "%sの指定なら、その引数だけを追加して送る",
    async (_name, range, expected) => {
      // Given
      const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });

      // When
      await database.createQueries().roundsList({
        ...listRequest,
        condition: { ...listRequest.condition, ...range },
      });

      // Then
      const args = database.rpcCalls[0]?.args ?? {};
      expect(args).toMatchObject(expected);
      expect(
        Object.keys(args).filter((key) => /^p_(date|score)_/.test(key)),
      ).toEqual(Object.keys(expected));
    },
  );

  it("距離の構成が1行以上なら、p_distancesに射つ順の行を、他の引数と一緒に1回のrpcで送る", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });
    const distances = [
      {
        distance: 50,
        arrowsPerEnd: 6,
        totalArrows: 36,
        targetFaceId: "a1000000-0000-0000-0000-000000000001",
      },
      {
        distance: 30,
        arrowsPerEnd: null,
        totalArrows: null,
        targetFaceId: null,
      },
    ];

    // When
    await database.createQueries().roundsList({
      ...listRequest,
      condition: { ...listRequest.condition, distances },
    });

    // Then
    expect(database.rpcCalls).toHaveLength(1);
    expect(database.rpcCalls[0]?.args).toMatchObject({
      p_sort_key: listRequest.condition.sortKey,
      p_distances: [
        {
          distance: 50,
          arrows_per_end: 6,
          total_arrows: 36,
          target_face_id: "a1000000-0000-0000-0000-000000000001",
        },
        {
          distance: 30,
          arrows_per_end: null,
          total_arrows: null,
          target_face_id: null,
        },
      ],
    });
  });

  it("距離の構成が空の配列なら、p_distancesを含めない", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });

    // When
    await database.createQueries().roundsList({
      ...listRequest,
      condition: { ...listRequest.condition, distances: [] },
    });

    // Then
    expect(database.rpcCalls[0]?.args).not.toHaveProperty("p_distances");
  });

  it("期間・得点の範囲と距離の構成を両方指定したら、10個の引数とp_distancesを共存させて送る", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });
    const distances = [
      {
        distance: 70,
        arrowsPerEnd: null,
        totalArrows: null,
        targetFaceId: null,
      },
    ];

    // When
    await database.createQueries().roundsList({
      ...request,
      condition: { ...request.condition, distances },
    });

    // Then
    expect(Object.keys(database.rpcCalls[0]?.args ?? {}).sort()).toEqual([
      "p_after_id",
      "p_bow_type",
      "p_date_from",
      "p_date_to",
      "p_distances",
      "p_format",
      "p_limit",
      "p_score_max",
      "p_score_min",
      "p_sort_direction",
      "p_sort_key",
    ]);
  });

  it("種別・弓種の指定なしと先頭のページの起点なしは、nullで渡す", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });

    // When
    await database.createQueries().roundsList(listRequest);

    // Then
    expect(database.rpcCalls[0]?.args).toMatchObject({
      p_format: null,
      p_bow_type: null,
      p_after_id: null,
    });
  });

  it("応答の行と続きの有無(has_more)を、ページ(行と続きの有無)にして返す", async () => {
    // Given
    const rounds = [
      {
        id: "round-1",
        name: "午前練習",
        round_date: "2026-09-15",
        total: 640,
      },
    ];
    const database = makeDatabase({
      rounds: ok([]),
      target_faces: noFaces,
      rounds_list: ok({ rounds, has_more: true }),
    });

    // When
    const response = await database.createQueries().roundsList(listRequest);

    // Then
    expect(response).toEqual({
      status: "ok",
      data: { rounds, hasMore: true },
    });
  });

  it("通信失敗(status 0)はcomm-failure、エラー応答はfailedの種類で返す", async () => {
    // Given
    const comm = makeDatabase({
      rounds: ok([]),
      target_faces: noFaces,
      rounds_list: failed(0),
    });
    const errored = makeDatabase({
      rounds: ok([]),
      target_faces: noFaces,
      rounds_list: failed(500, { message: "x" }),
    });

    // When
    const first = await comm.createQueries().roundsList(listRequest);
    const second = await errored.createQueries().roundsList(listRequest);

    // Then
    expect(first).toEqual({ status: "comm-failure" });
    expect(second).toEqual({ status: "failed" });
  });

  it("失敗しても自動で再試行せず、1回だけ呼ぶ", async () => {
    // Given
    const database = makeDatabase({
      rounds: ok([]),
      target_faces: noFaces,
      rounds_list: failed(500, { message: "x" }),
    });

    // When
    await database.createQueries().roundsList(listRequest);

    // Then
    expect(database.rpcCalls).toHaveLength(1);
  });
});

describe("roundsList: 距離単位", () => {
  const noFaces = ok(null);
  const rowArg = {
    distance: 50,
    arrows_per_end: 6,
    total_arrows: 36,
    target_face_id: "a1000000-0000-0000-0000-000000000001",
  };
  const distanceRow = {
    distance: 50,
    arrowsPerEnd: 6,
    totalArrows: 36,
    targetFaceId: "a1000000-0000-0000-0000-000000000001",
  };
  const distanceCondition: HistoryCondition = {
    unit: "distance",
    sortKey: "score",
    sortDirection: "asc",
    format: "indoor",
    bowType: "compound",
    dateFrom: "2026-05-01",
    dateTo: "2026-05-31",
    scoreMin: 0,
    scoreMax: 600,
    distances: [],
    distanceRow: null,
  };
  const request = { condition: distanceCondition, after: "d-9", size: 25 };

  it("単位が距離なら、distances_listを1回のrpcで呼び、rounds_listは呼ばず、他の条件と続きの起点(距離のID)と件数を、rounds_listと同じ名前で写す", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });

    // When
    await database.createQueries().roundsList(request);

    // Then
    expect(database.queries).toHaveLength(0);
    expect(database.rpcCalls).toEqual([
      {
        name: "distances_list",
        args: {
          p_sort_key: "score",
          p_sort_direction: "asc",
          p_format: "indoor",
          p_bow_type: "compound",
          p_after_id: "d-9",
          p_limit: 25,
          p_date_from: "2026-05-01",
          p_date_to: "2026-05-31",
          p_score_min: 0,
          p_score_max: 600,
        },
      },
    ]);
  });

  it("距離の行が指定ありなら、p_distanceに1つのオブジェクトで送る", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });

    // When
    await database.createQueries().roundsList({
      ...request,
      condition: { ...distanceCondition, distanceRow },
    });

    // Then
    expect(database.rpcCalls[0]?.args).toMatchObject({ p_distance: rowArg });
  });

  it("距離の行が指定なしなら、p_distanceを含めない", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });

    // When
    await database.createQueries().roundsList(request);

    // Then
    expect(database.rpcCalls[0]?.args).not.toHaveProperty("p_distance");
  });

  it("距離の構成と距離の行の両方があれば、p_distancesとp_distanceを共存させて送る", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });
    const distances = [{ ...distanceRow, distance: 30 }];

    // When
    await database.createQueries().roundsList({
      ...request,
      condition: { ...distanceCondition, distances, distanceRow },
    });

    // Then
    expect(database.rpcCalls[0]?.args).toMatchObject({
      p_distances: [{ ...rowArg, distance: 30 }],
      p_distance: rowArg,
    });
  });

  it("単位がラウンドなら、距離の行が条件に残っていても、rounds_listの引数に含めず、distances_listを呼ばない", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });

    // When
    await database.createQueries().roundsList({
      ...request,
      condition: { ...distanceCondition, unit: "round", distanceRow },
    });

    // Then
    expect(database.rpcCalls).toHaveLength(1);
    expect(database.rpcCalls[0]?.name).toBe("rounds_list");
    expect(database.rpcCalls[0]?.args).not.toHaveProperty("p_distance");
  });

  it("応答の距離の行と続きの有無(has_more)を、ページにして返す", async () => {
    // Given
    const distances = [
      {
        id: "d-1",
        round_id: "round-1",
        name: "午前練習",
        round_date: "2026-09-15",
        number: 1,
        distance: 50,
        is_marked: true,
        total: 300,
      },
    ];
    const database = makeDatabase({
      rounds: ok([]),
      target_faces: noFaces,
      distances_list: ok({ distances, has_more: true }),
    });

    // When
    const response = await database.createQueries().roundsList(request);

    // Then
    expect(response).toEqual({
      status: "ok",
      data: { distances, hasMore: true },
    });
  });

  it("通信失敗(status 0)はcomm-failure、エラー応答はfailedの種類で返し、どちらも再試行せず1回だけ呼ぶ", async () => {
    // Given
    const comm = makeDatabase({
      rounds: ok([]),
      target_faces: noFaces,
      distances_list: failed(0),
    });
    const errored = makeDatabase({
      rounds: ok([]),
      target_faces: noFaces,
      distances_list: failed(500, { message: "x" }),
    });

    // When
    const first = await comm.createQueries().roundsList(request);
    const second = await errored.createQueries().roundsList(request);

    // Then
    expect(first).toEqual({ status: "comm-failure" });
    expect(second).toEqual({ status: "failed" });
    expect(comm.rpcCalls).toHaveLength(1);
    expect(errored.rpcCalls).toHaveLength(1);
  });
});

describe("presets", () => {
  const noFaces = ok(null);
  const presetRow = {
    id: "preset-1",
    name: "70m",
    format: "outdoor",
    bow_type: "recurve",
    owner_id: "user-1",
    created_at: "2026-09-01T00:00:00Z",
    preset_distances: [
      {
        id: "pd-1",
        position_key: "1-1",
        distance: 70,
        is_marked: true,
        total_ends: 6,
        arrows_per_end: 6,
        target_face_id: "face-1",
        target_faces: { size: 122, target_face_spots: [] },
      },
    ],
  };

  it("自分の個人プリセットと公式プリセットだけを要求する1回の問い合わせを発行する", async () => {
    // Given
    const database = makeDatabase({
      rounds: ok(null),
      target_faces: noFaces,
      preset_rounds: ok([]),
    });

    // When
    await database.createQueries().presets("user-1");

    // Then
    expect(database.queries).toEqual([
      {
        table: "preset_rounds",
        columns: ROUND_PRESET_SELECT,
        filters: [
          { op: "or", expression: "owner_id.is.null,owner_id.eq.user-1" },
        ],
      },
    ]);
  });

  it("応答の行を、列名のまま、入れ子の距離と的を含めて返す", async () => {
    // Given
    const database = makeDatabase({
      rounds: ok(null),
      target_faces: noFaces,
      preset_rounds: ok([presetRow]),
    });

    // When
    const response = await database.createQueries().presets("user-1");

    // Then
    expect(response).toEqual({ status: "ok", data: [presetRow] });
  });

  it("通信失敗(status 0)はcomm-failure、エラー応答はfailedの種類で返す", async () => {
    // Given
    const comm = makeDatabase({
      rounds: ok(null),
      target_faces: noFaces,
      preset_rounds: failed(0),
    });
    const errored = makeDatabase({
      rounds: ok(null),
      target_faces: noFaces,
      preset_rounds: failed(500, { message: "x" }),
    });

    // When
    const first = await comm.createQueries().presets("user-1");
    const second = await errored.createQueries().presets("user-1");

    // Then
    expect(first).toEqual({ status: "comm-failure" });
    expect(second).toEqual({ status: "failed" });
  });
});
