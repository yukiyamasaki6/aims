import { describe, expect, it } from "vitest";
import type {
  DatabaseGateway,
  DbResponse,
  DbSelect,
} from "@/lib/supabase/contract/database";
import type { QueryOutcome } from "../domain/query-outcome";
import {
  ROUND_PRESET_SELECT,
  TARGET_FACE_SELECT,
} from "./reference-query-constants";
import { createRoundQueries } from "./round-queries";
import type { RoundsDbSchema } from "./rounds-db-schema";

// 問い合わせの値が検証対象で、表の名前の型引数は区別しない。
type Query = DbSelect<
  RoundsDbSchema,
  "rounds" | "distances" | "target_faces" | "preset_rounds"
>;

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
};

// データベースの境界を、表ごとの応答を返し、受けた問い合わせを記録するゲートウェイで模す。
function makeDatabase(responses: Responses) {
  const queries: Query[] = [];
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
      status: "ok",
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

  it("ラウンドがnullなら的の結果によらずnot-foundにし、的のデータがnullなら的を空にする", async () => {
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
    expect(notFound).toEqual({ status: "not-found" });
    expect(dataOf(found)?.targetFaces).toEqual([]);
  });

  it("どちらかが通信失敗(status 0)なら、もう一方がエラーでも、comm-failureにする", async () => {
    // Given
    const database = makeDatabase({
      rounds: failed(500, { message: "boom" }),
      target_faces: failed(0),
    });

    // When
    const response = await database.createQueries().roundDetail("u", "r");

    // Then
    expect(response).toEqual({ status: "comm-failure" });
  });

  it("的の通信失敗は、ラウンドが見つからない場合もnot-foundより優先してcomm-failureにする", async () => {
    // Given
    const database = makeDatabase({
      rounds: ok(null),
      target_faces: failed(0),
    });

    // When
    const response = await database.createQueries().roundDetail("u", "r");

    // Then
    expect(response).toEqual({ status: "comm-failure" });
  });

  it("どちらかが401なら、他のエラーより優先してauth-rejectedにする", async () => {
    // Given
    const jwt = { code: "PGRST301", message: "jwt" };
    const database = makeDatabase({
      rounds: failed(500, { message: "boom" }),
      target_faces: failed(401, jwt),
    });

    // When
    const response = await database.createQueries().roundDetail("u", "r");

    // Then
    expect(response).toEqual({ status: "auth-rejected" });
  });

  it("ラウンドか的のサーバーエラーは、failedにする", async () => {
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
    expect(first).toEqual({ status: "failed" });
    expect(second).toEqual({ status: "failed" });
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
    expect(response).toEqual({ status: "ok", data: [face("g", null)] });
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0].filters).toEqual([
      { op: "or", expression: "owner_id.is.null,owner_id.eq.user-1" },
    ]);
    expect(emptyResponse).toEqual({ status: "ok", data: [] });
  });

  it("通信が失敗(status 0)したらcomm-failure、エラー応答はfailedの種類で返す", async () => {
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
    expect(first).toEqual({ status: "comm-failure" });
    expect(second).toEqual({ status: "failed" });
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

describe("roundsList", () => {
  const noFaces = ok(null);

  it("削除されていないラウンドを、利用者で絞らず、日付の新しい順に1回の問い合わせで得る", async () => {
    // Given
    const database = makeDatabase({ rounds: ok([]), target_faces: noFaces });

    // When
    await database.createQueries().roundsList();

    // Then
    expect(database.queries).toEqual([
      {
        table: "rounds",
        columns:
          "id, name, round_date, distances(disabled_at, shots(score_int, disabled_at))",
        filters: [{ op: "is", column: "disabled_at", value: null }],
        orders: [{ column: "round_date", ascending: false }],
      },
    ]);
  });

  it("行の名前を内側の形に写し、削除の印を距離と矢の両方で真偽にする", async () => {
    // Given
    const database = makeDatabase({
      rounds: {
        data: [
          {
            id: "round-1",
            name: "午前練習",
            round_date: "2026-09-15",
            distances: [
              {
                disabled_at: null,
                shots: [
                  { score_int: 10, disabled_at: null },
                  { score_int: 9, disabled_at: "2026-09-15T10:00:00Z" },
                ],
              },
              {
                disabled_at: "2026-09-15T11:00:00Z",
                shots: [{ score_int: 8, disabled_at: null }],
              },
            ],
          },
        ],
        error: null,
        status: 206,
      },
      target_faces: noFaces,
    });

    // When
    const response = await database.createQueries().roundsList();

    // Then
    expect(response).toEqual({
      status: "ok",
      data: [
        {
          id: "round-1",
          name: "午前練習",
          roundDate: "2026-09-15",
          distances: [
            {
              disabled: false,
              shots: [
                { score_int: 10, disabled: false },
                { score_int: 9, disabled: true },
              ],
            },
            { disabled: true, shots: [{ score_int: 8, disabled: false }] },
          ],
        },
      ],
    });
  });

  it("データがnullなら空の配列を返す", async () => {
    // Given
    const database = makeDatabase({ rounds: ok(null), target_faces: noFaces });

    // When
    const response = await database.createQueries().roundsList();

    // Then
    expect(response).toEqual({ status: "ok", data: [] });
  });

  it("通信失敗(status 0)はcomm-failure、エラー応答はfailedの種類で返す", async () => {
    // Given
    const comm = makeDatabase({ rounds: failed(0), target_faces: noFaces });
    const errored = makeDatabase({
      rounds: failed(500, { message: "x" }),
      target_faces: noFaces,
    });

    // When
    const first = await comm.createQueries().roundsList();
    const second = await errored.createQueries().roundsList();

    // Then
    expect(first).toEqual({ status: "comm-failure" });
    expect(second).toEqual({ status: "failed" });
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

  it("距離の的が、1つのオブジェクトまたはnullのまま返る", async () => {
    // Given
    const withoutFace = {
      ...presetRow,
      id: "preset-2",
      preset_distances: [
        { ...presetRow.preset_distances[0], target_faces: null },
      ],
    };
    const database = makeDatabase({
      rounds: ok(null),
      target_faces: noFaces,
      preset_rounds: ok([presetRow, withoutFace]),
    });

    // When
    const response = await database.createQueries().presets("user-1");

    // Then
    const [first, second] = dataOf(response) ?? [];
    expect(first.preset_distances[0].target_faces).toEqual({
      size: 122,
      target_face_spots: [],
    });
    expect(second.preset_distances[0].target_faces).toBeNull();
  });

  it("データがnullなら空の配列を返す", async () => {
    // Given
    const database = makeDatabase({
      rounds: ok(null),
      target_faces: noFaces,
      preset_rounds: ok(null),
    });

    // When
    const response = await database.createQueries().presets("user-1");

    // Then
    expect(response).toEqual({ status: "ok", data: [] });
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
