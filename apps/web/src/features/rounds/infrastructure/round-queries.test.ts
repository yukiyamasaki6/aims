import { describe, expect, it } from "vitest";
import type {
  DatabaseGateway,
  DbResponse,
  DbSelect,
} from "@/lib/supabase/contract/database";
import { TARGET_FACE_SELECT } from "./reference-query-constants";
import { createRoundQueries } from "./round-queries";
import type { RoundsDbSchema } from "./rounds-db-schema";

// 問い合わせの値が検証対象で、表の名前の型引数は区別しない。
type Query = DbSelect<RoundsDbSchema, "rounds" | "distances" | "target_faces">;

const ok = (data: unknown): DbResponse => ({ data, error: null, status: 200 });
const failed = (
  status: number,
  error: DbResponse["error"] = null,
): DbResponse => ({
  data: null,
  error,
  status,
});

type Responses = {
  rounds: DbResponse | ((roundsQueryIndex: number) => DbResponse);
  target_faces: DbResponse;
};

// データベースの境界を、表ごとの応答を返し、受けた問い合わせを記録するゲートウェイで模す。
function makeDatabase(responses: Responses) {
  const queries: Query[] = [];
  let roundsCount = 0;
  const database: DatabaseGateway<RoundsDbSchema> = {
    async select(query) {
      queries.push(query as unknown as Query);
      if (query.table === "target_faces") return responses.target_faces;
      const source = responses.rounds;
      return typeof source === "function" ? source(roundsCount++) : source;
    },
    async rpc() {
      throw new Error("取得はRPCを使わない");
    },
  };
  return {
    queries,
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
  it("ラウンド(距離・記録を含む)を1回、的を自分の分と公式の分に絞って1回、取得する", async () => {
    // Given
    const database = makeDatabase({ rounds: ok(round), target_faces: ok([]) });

    // When
    await database.createQueries().roundDetail("user-1", "round-1");

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
      },
      {
        table: "target_faces",
        columns: TARGET_FACE_SELECT,
        filters: [
          { op: "or", expression: "owner_id.is.null,owner_id.eq.user-1" },
        ],
      },
    ]);
  });

  it("行の名前を内側の形に写し、無効化の印を真偽にして、的とともに返す", async () => {
    // Given
    const disabledAt = "2026-09-16T00:00:00Z";
    const database = makeDatabase({
      rounds: ok({
        ...round,
        distances: [
          {
            ...round.distances[0],
            shots: [{ ...shotA, revision: 8, disabled_at: disabledAt }],
          },
        ],
      }),
      target_faces: ok([face("g", null)]),
    });

    // When
    const response = await database
      .createQueries()
      .roundDetail("user-1", "round-1");

    // Then
    expect(response).toEqual({
      status: 200,
      error: null,
      data: {
        round: {
          id: "round-1",
          roundConfig: {
            name: "午前練習",
            roundDate: "2026-09-15",
            format: "outdoor",
            bowType: "recurve",
          },
          status: "completed",
          revision: 3,
          distances: [
            {
              ...distanceA,
              revision: 4,
              disabled: false,
              shots: [{ ...shotA, revision: 8, disabled: true }],
            },
          ],
        },
        targetFaces: [face("g", null)],
      },
    });
  });

  it("ラウンドがnullなら的の結果によらずdataをnullにし、的のデータがnullなら的を空にする", async () => {
    // Given
    const missing = makeDatabase({
      rounds: ok(null),
      target_faces: ok([face("g", null)]),
    });
    const nullFaces = makeDatabase({
      rounds: ok(round),
      target_faces: ok(null),
    });

    // When
    const notFound = await missing.createQueries().roundDetail("user-1", "r");
    const found = await nullFaces.createQueries().roundDetail("user-1", "r");

    // Then
    expect(notFound).toEqual({ data: null, error: null, status: 200 });
    expect(found.data?.targetFaces).toEqual([]);
  });

  it("どちらかが通信失敗(status 0)なら、もう一方がエラーでも、通信失敗を返す", async () => {
    // Given
    const database = makeDatabase({
      rounds: failed(500, { message: "boom" }),
      target_faces: failed(0),
    });

    // When
    const response = await database.createQueries().roundDetail("u", "r");

    // Then
    expect(response.status).toBe(0);
  });

  it("的の通信失敗は、ラウンドが見つからない場合も失敗として返す", async () => {
    // Given
    const database = makeDatabase({
      rounds: ok(null),
      target_faces: failed(0),
    });

    // When
    const response = await database.createQueries().roundDetail("u", "r");

    // Then
    expect(response.status).toBe(0);
  });

  it("どちらかが401なら、他のエラーより優先して認証の拒否を返す", async () => {
    // Given
    const jwt = { code: "PGRST301", message: "jwt" };
    const database = makeDatabase({
      rounds: failed(500, { message: "boom" }),
      target_faces: failed(401, jwt),
    });

    // When
    const response = await database.createQueries().roundDetail("u", "r");

    // Then
    expect(response).toMatchObject({ status: 401, error: jwt });
  });

  it("ラウンドか的のサーバーエラーは、そのエラーを返す", async () => {
    // Given
    const roundError = makeDatabase({
      rounds: failed(500, { message: "round" }),
      target_faces: ok([]),
    });
    const faceError = makeDatabase({
      rounds: ok(round),
      target_faces: failed(500, { message: "faces" }),
    });

    // When
    const first = await roundError.createQueries().roundDetail("u", "r");
    const second = await faceError.createQueries().roundDetail("u", "r");

    // Then
    expect(first.error?.message).toBe("round");
    expect(second.error?.message).toBe("faces");
  });
});

describe("targetFaces", () => {
  it("的だけを、自分の分と公式の分に絞って取得して返す。データがnullなら空にする", async () => {
    // Given
    const database = makeDatabase({
      rounds: ok(null),
      target_faces: ok([face("g", null)]),
    });
    const empty = makeDatabase({ rounds: ok(null), target_faces: ok(null) });

    // When
    const response = await database.createQueries().targetFaces("user-1");
    const emptyResponse = await empty.createQueries().targetFaces("user-1");

    // Then
    expect(response).toEqual({
      data: [face("g", null)],
      error: null,
      status: 200,
    });
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0].filters).toEqual([
      { op: "or", expression: "owner_id.is.null,owner_id.eq.user-1" },
    ]);
    expect(emptyResponse.data).toEqual([]);
  });

  it("通信が失敗(status 0)したら、その応答をそのまま返し、エラー応答もそのまま返す", async () => {
    // Given
    const comm = makeDatabase({ rounds: ok(null), target_faces: failed(0) });
    const errored = makeDatabase({
      rounds: ok(null),
      target_faces: failed(500, { message: "x" }),
    });

    // When
    const first = await comm.createQueries().targetFaces("u");
    const second = await errored.createQueries().targetFaces("u");

    // Then
    expect(first.status).toBe(0);
    expect(second).toMatchObject({ status: 500, error: { message: "x" } });
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

  it("入力中のラウンドと指定したラウンドを1回の取得で得る。UUIDでないIDは含めない", async () => {
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
      .roundDetails("user-1", [uuid2, "not-a-uuid"]);

    // Then
    const [query] = database.queries_of("rounds");
    expect(query.filters).toEqual([
      { op: "is", column: "disabled_at", value: null },
      { op: "or", expression: `status.eq.in_progress,id.in.(${uuid2})` },
    ]);
    expect(response.data?.rounds.map((r) => r.id)).toEqual([uuid1, uuid2]);
    expect(response.data?.targetFaces).toEqual([face("face-1", null)]);
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

  it("UUIDでないIDは件数に数えない", async () => {
    // Given
    const junk = Array.from({ length: 10 }, (_, i) => `bad-${i}`);
    const database = makeDatabase({ rounds: ok([]), target_faces: ok([]) });

    // When
    await database
      .createQueries()
      .roundDetails("user-1", [...junk, ...uuids(50)]);

    // Then
    expect(database.queries_of("rounds")).toHaveLength(1);
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
    expect(response.data?.rounds.map((r) => [r.id, r.revision])).toEqual([
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
    expect(first.status).toBe(0);
    expect(second).toMatchObject({ status: 500, error: { message: "x" } });
  });
});
