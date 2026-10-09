import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";
import {
  FALLBACK_WAIT_MS,
  FETCH_TIMEOUT_MS,
} from "@/features/fetch-result/fetch-content";
import { FETCH_ERROR_MESSAGE } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { TARGET_FACE_SELECT } from "../_shared/reference-query-constants";
import {
  loadReferenceSnapshot,
  saveReferenceSnapshot,
} from "../_shared/reference-snapshot";
import {
  fetchRoundDetail,
  fetchRoundDetails,
  fetchTargetFaces,
} from "./fetch-round-detail";

beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

type Response = { data: unknown; error: unknown; status: number };
type Call = [method: string, args: unknown[]];

// Supabaseクライアントは外部サービスとの境界のため、テーブルごとの取得結果を返し、組み立てたクエリを記録するスタブで模す。
// クエリビルダーはメソッドチェーンの後にawaitで結果を返すため、任意のメソッドを記録して自身を返し、thenで結果を返すProxyで表す。
function makeSupabase(
  responses: { rounds: Response; target_faces: Response },
  session: unknown = { user: { id: "user-1" } },
  delayMs = 0,
) {
  const queries: { table: string; calls: Call[] }[] = [];
  function createQuery(table: "rounds" | "target_faces"): unknown {
    const calls: Call[] = [];
    queries.push({ table, calls });
    const query: unknown = new Proxy(
      {},
      {
        get(_, method) {
          if (method === "then") {
            return (resolve: (value: unknown) => void) => {
              if (delayMs > 0) {
                setTimeout(() => resolve(responses[table]), delayMs);
              } else {
                resolve(responses[table]);
              }
            };
          }
          return (...args: unknown[]) => {
            calls.push([String(method), args]);
            return query;
          };
        },
      },
    );
    return query;
  }
  const client = {
    auth: { getSession: async () => ({ data: { session } }) },
    from: createQuery,
  } as unknown as SupabaseClient<Database>;
  return { client, queries };
}

const ok = (data: unknown): Response => ({ data, error: null, status: 200 });
const failed = (status: number, error: unknown = null): Response => ({
  data: null,
  error,
  status,
});

const distanceA = {
  id: "d-a",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
};
const distanceB = { ...distanceA, id: "d-b", position_key: "b" };
const shotA = {
  id: "s-a",
  distance_id: "d-a",
  end_number: 1,
  shooter_id: "user-1",
  score_str: "X",
  score_int: 10,
  shot_number: null,
};
const shotB = {
  ...shotA,
  id: "s-b",
  distance_id: "d-b",
  score_str: "9",
  score_int: 9,
  shot_number: 2,
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
    {
      ...distanceB,
      revision: 6,
      disabled_at: null,
      shots: [{ ...shotB, revision: 7, disabled_at: null }],
    },
  ],
};

function face(id: string, owner_id: string | null, overrides = {}) {
  return {
    id,
    name: id,
    size: 122,
    format: "outdoor",
    bow_type: ["recurve"],
    owner_id,
    target_face_spots: [],
    ...overrides,
  };
}

describe("fetchRoundDetail", () => {
  describe("正常系", () => {
    it("ラウンド（距離・記録を含む）を1回、的を自分の分と公式の分に絞って1回、どちらも再試行なしで発行する", async () => {
      // Given
      const { client, queries } = makeSupabase({
        rounds: ok(round),
        target_faces: ok([]),
      });

      // When
      await fetchRoundDetail(client, "round-1");

      // Then: 論理削除された距離・記録も取得し(revisionの判定に使う)、他人の個人の的を要求しない
      expect(queries).toEqual([
        {
          table: "rounds",
          calls: [
            [
              "select",
              [
                "id, name, round_date, format, bow_type, status, revision, distances(id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, revision, disabled_at, shots(id, distance_id, end_number, shooter_id, score_str, score_int, shot_number, revision, disabled_at))",
              ],
            ],
            ["eq", ["id", "round-1"]],
            ["is", ["disabled_at", null]],
            ["order", ["position_key", { referencedTable: "distances" }]],
            ["order", ["id", { referencedTable: "distances" }]],
            ["maybeSingle", []],
            ["retry", [false]],
          ],
        },
        {
          table: "target_faces",
          calls: [
            ["select", [TARGET_FACE_SELECT]],
            ["or", ["owner_id.is.null,owner_id.eq.user-1"]],
            ["retry", [false]],
          ],
        },
      ]);
    });

    it("ラウンドの設定・距離・全距離の記録を、スコアカードが扱う形で返す", async () => {
      // Given
      const { client } = makeSupabase({
        rounds: ok(round),
        target_faces: ok([]),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result).toEqual({
        status: "ok",
        data: {
          status: "completed",
          roundConfig: {
            name: "午前練習",
            roundDate: "2026-09-15",
            format: "outdoor",
            bowType: "recurve",
          },
          distances: [distanceA, distanceB],
          shots: [shotA, shotB],
          targetFaces: [],
          revisions: {
            round: 3,
            distances: { "d-a": 4, "d-b": 6 },
            shots: { "s-a": 5, "s-b": 7 },
          },
          startedAt: expect.any(Number),
          userId: "user-1",
        },
      });
    });

    it("無効化された距離・記録は、表示に含めず、revisionだけを返す", async () => {
      // Given: d-aの記録が無効化され、d-bが無効化されている
      const disabledAt = "2026-09-16T00:00:00Z";
      const { client } = makeSupabase({
        rounds: ok({
          ...round,
          distances: [
            {
              ...distanceA,
              revision: 4,
              disabled_at: null,
              shots: [{ ...shotA, revision: 8, disabled_at: disabledAt }],
            },
            {
              ...distanceB,
              revision: 9,
              disabled_at: disabledAt,
              shots: [{ ...shotB, revision: 7, disabled_at: null }],
            },
          ],
        }),
        target_faces: ok([]),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then: 表示は距離d-aだけで記録は無く、revisionは無効化された行の分も持つ
      expect(result).toMatchObject({
        status: "ok",
        data: {
          distances: [distanceA],
          shots: [],
          revisions: {
            distances: { "d-a": 4, "d-b": 9 },
            shots: { "s-a": 8, "s-b": 7 },
          },
        },
      });
    });

    it("距離が無いラウンドは、距離と記録を空のokとする", async () => {
      const { client } = makeSupabase({
        rounds: ok({ ...round, distances: [] }),
        target_faces: ok([]),
      });

      const result = await fetchRoundDetail(client, "round-1");

      expect(result).toMatchObject({
        status: "ok",
        data: { distances: [], shots: [] },
      });
    });

    it("的は個人を先に、それぞれ種類（outdoor→indoor→field）・サイズ（大→小）・名前の順に並べる", async () => {
      // Given
      const { client } = makeSupabase({
        rounds: ok(round),
        target_faces: ok([
          face("g-field", null, { format: "field" }),
          face("p-small", "user-1", { size: 40 }),
          face("g-indoor", null, { format: "indoor" }),
          face("g-b", null),
          face("g-a", null),
          face("g-small", null, { size: 80 }),
          face("p-big", "user-1"),
        ]),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.data.targetFaces.map((f) => f.id)).toEqual([
        "p-big",
        "p-small",
        "g-a",
        "g-b",
        "g-small",
        "g-indoor",
        "g-field",
      ]);
    });

    it("的のデータがnullでも、的を空としてokとする", async () => {
      const { client } = makeSupabase({
        rounds: ok(round),
        target_faces: ok(null),
      });

      const result = await fetchRoundDetail(client, "round-1");

      expect(result).toMatchObject({ status: "ok", data: { targetFaces: [] } });
    });
  });

  describe("見つからない場合", () => {
    it("ラウンドがnull（存在しない・権限なし・論理削除済み）なら、的の取得結果によらずnot-foundとする", async () => {
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: ok([face("g", null)]),
      });

      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "not-found",
      });
    });
  });

  describe("失敗の分類", () => {
    it("オフラインではクエリを発行せずofflineを返す", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { client, queries } = makeSupabase({
        rounds: ok(round),
        target_faces: ok([]),
      });

      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "offline",
      });
      expect(queries).toEqual([]);
    });

    it("どちらかの通信が失敗(status 0)したら、もう一方がエラーでも、原因を断定せずerrorとする", async () => {
      const { client } = makeSupabase({
        rounds: failed(500, { message: "boom" }),
        target_faces: failed(0),
      });

      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
    });

    it("的の通信失敗は、ラウンドが見つからない場合もerrorとし、見つからないと誤判定しない", async () => {
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: failed(0),
      });

      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
    });

    it("どちらかが401なら、他のエラーより優先してサインインが必要なエラーとする", async () => {
      const { client } = makeSupabase({
        rounds: failed(500, { message: "boom" }),
        target_faces: failed(401, { message: "jwt" }),
      });

      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
    });

    it("ラウンドのサーバーエラーは取得エラーとする", async () => {
      const { client } = makeSupabase({
        rounds: failed(500, { message: "boom" }),
        target_faces: ok([]),
      });

      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("的のサーバーエラーは取得エラーとする", async () => {
      const { client } = makeSupabase({
        rounds: ok(round),
        target_faces: failed(500, { message: "boom" }),
      });

      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("セッションが無い場合は、クエリを発行せずサインインが必要なエラーとする", async () => {
      const { client, queries } = makeSupabase(
        { rounds: ok(round), target_faces: ok([]) },
        null,
      );

      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(queries).toEqual([]);
    });

    it("取得中にセッションのユーザーIDが失われた場合は、クエリを発行せずサインインが必要なエラーとする", async () => {
      // Given: fetchContentの確認は通り、クエリ直前のセッション取得では無い
      let calls = 0;
      const { client, queries } = makeSupabase({
        rounds: ok(round),
        target_faces: ok([]),
      });
      client.auth.getSession = (async () => {
        calls += 1;
        return {
          data: { session: calls === 1 ? { user: { id: "user-1" } } : null },
        };
      }) as typeof client.auth.getSession;

      // When/Then
      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(queries).toEqual([]);
    });
  });
});

describe("fetchTargetFaces", () => {
  it("的だけを取得し、共通の的を先に並べて返す", async () => {
    const { client, queries } = makeSupabase({
      rounds: ok(null),
      target_faces: ok([face("own", "user-1"), face("common", null)]),
    });

    const result = await fetchTargetFaces(client);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.map((f) => f.id).sort()).toEqual(["common", "own"]);
    expect(queries.map((q) => q.table)).toEqual(["target_faces"]);
  });

  it("サインインしていない場合は、クエリを発行せずサインインを求める", async () => {
    const { client, queries } = makeSupabase(
      { rounds: ok(null), target_faces: ok([]) },
      null,
    );

    await expect(fetchTargetFaces(client)).resolves.toEqual({
      status: "error",
      message: AUTH_REQUIRED_MESSAGE,
    });
    expect(queries).toEqual([]);
  });

  it("オフラインではクエリを発行せずofflineを返す", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { client, queries } = makeSupabase({
      rounds: ok(null),
      target_faces: ok([]),
    });

    await expect(fetchTargetFaces(client)).resolves.toEqual({
      status: "offline",
    });
    expect(queries).toEqual([]);
  });

  it("通信が失敗(status 0)したら、そのレスポンスをそのまま返す", async () => {
    const { client } = makeSupabase({
      rounds: ok(null),
      target_faces: failed(0),
    });

    const result = await fetchTargetFaces(client);

    expect(result.status).toBe("error");
  });

  it("エラーレスポンスはerrorとして返す", async () => {
    const { client } = makeSupabase({
      rounds: ok(null),
      target_faces: failed(500, { message: "boom" }),
    });

    const result = await fetchTargetFaces(client);

    expect(result.status).toBe("error");
  });

  it("データがnullなら空の一覧として返す", async () => {
    const { client } = makeSupabase({
      rounds: ok(null),
      target_faces: ok(null),
    });

    await expect(fetchTargetFaces(client)).resolves.toEqual({
      status: "ok",
      data: [],
    });
  });
});

describe("的の端末への保存", () => {
  const IDENTITY_KEY = "aims:local-user-id";
  const SAVED = [face("saved", null)];
  const idsOf = (faces: unknown) =>
    (faces as { id: string }[]).map((f) => f.id);

  function saveBefore() {
    localStorage.setItem(IDENTITY_KEY, "user-1");
    saveReferenceSnapshot("target-faces", "user-1", SAVED, 1);
  }

  describe("fetchTargetFaces", () => {
    it("okの結果を並べて、クエリのユーザーのキーへ保存する", async () => {
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: ok([face("own", "user-1"), face("common", null)]),
      });

      await fetchTargetFaces(client);

      localStorage.setItem(IDENTITY_KEY, "user-1");
      expect(idsOf(loadReferenceSnapshot("target-faces"))).toEqual([
        "own",
        "common",
      ]);
    });

    it("取得できたときは、保存済みを最新で上書きして返す(サーバーでの変更・削除の反映)", async () => {
      saveBefore();
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: ok([face("fresh", null)]),
      });

      const result = await fetchTargetFaces(client);

      expect(result.status === "ok" && idsOf(result.data)).toEqual(["fresh"]);
      expect(idsOf(loadReferenceSnapshot("target-faces"))).toEqual(["fresh"]);
    });

    it.each([
      ["通信失敗", { data: null, error: null, status: 0 }],
      ["サーバーエラー", { data: null, error: { message: "x" }, status: 500 }],
    ])("%sのとき、保存済みがあればそれを返す", async (_n, response) => {
      saveBefore();
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: response as Response,
      });

      await expect(fetchTargetFaces(client)).resolves.toEqual({
        status: "ok",
        data: SAVED,
      });
    });

    it("オフラインのとき、保存済みがあればそれを返し、無ければofflineを返す", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: ok([]),
      });
      await expect(fetchTargetFaces(client)).resolves.toEqual({
        status: "offline",
      });

      saveBefore();

      await expect(fetchTargetFaces(client)).resolves.toEqual({
        status: "ok",
        data: SAVED,
      });
    });

    it("保存済みがあると、FALLBACK_WAIT_MSで終わらない取得を待たず保存済みを返す", async () => {
      vi.useFakeTimers();
      saveBefore();
      const { client } = makeSupabase(
        { rounds: ok(null), target_faces: ok([face("fresh", null)]) },
        undefined,
        5_000,
      );
      const pending = fetchTargetFaces(client);

      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);

      await expect(pending).resolves.toEqual({ status: "ok", data: SAVED });
    });

    it("保存済みが無いと、FALLBACK_WAIT_MSでは返らず、FETCH_TIMEOUT_MSでerrorになる", async () => {
      vi.useFakeTimers();
      const { client } = makeSupabase(
        { rounds: ok(null), target_faces: ok([]) },
        undefined,
        FETCH_TIMEOUT_MS * 2,
      );
      let settled = false;
      const pending = fetchTargetFaces(client).finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - FALLBACK_WAIT_MS);

      await expect(pending).resolves.toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("時間切れの後に届いたokは表示に使わず、開始時のユーザーのキーへ保存し、識別が変わっても新しいユーザーのキーへ書かない", async () => {
      vi.useFakeTimers();
      saveBefore();
      const { client } = makeSupabase(
        { rounds: ok(null), target_faces: ok([face("late", null)]) },
        undefined,
        3_000,
      );
      const pending = fetchTargetFaces(client);
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      await expect(pending).resolves.toEqual({ status: "ok", data: SAVED });
      localStorage.setItem(IDENTITY_KEY, "user-2");

      await vi.advanceTimersByTimeAsync(3_000);

      localStorage.setItem(IDENTITY_KEY, "user-1");
      expect(idsOf(loadReferenceSnapshot("target-faces"))).toEqual(["late"]);
    });

    it("時間切れの後に届いた結果がok以外なら、保存済みは変わらない", async () => {
      vi.useFakeTimers();
      saveBefore();
      const { client } = makeSupabase(
        { rounds: ok(null), target_faces: failed(500, { message: "x" }) },
        undefined,
        3_000,
      );
      const pending = fetchTargetFaces(client);
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      await pending;

      await vi.advanceTimersByTimeAsync(3_000);

      expect(loadReferenceSnapshot("target-faces")).toEqual(SAVED);
    });
  });

  describe("fetchRoundDetail", () => {
    it("okのとき、並べた的をクエリのユーザーのキーへ保存する", async () => {
      const { client } = makeSupabase({
        rounds: ok(round),
        target_faces: ok([face("own", "user-1"), face("common", null)]),
      });

      await fetchRoundDetail(client, "round-1");

      localStorage.setItem(IDENTITY_KEY, "user-1");
      expect(idsOf(loadReferenceSnapshot("target-faces"))).toEqual([
        "own",
        "common",
      ]);
    });

    it("失敗のときは、保存済みがあっても代わりにせず、結果をそのまま返す", async () => {
      saveBefore();
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { client } = makeSupabase({
        rounds: ok(round),
        target_faces: ok([]),
      });

      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "offline",
      });
      expect(loadReferenceSnapshot("target-faces")).toEqual(SAVED);
    });

    it("待ちは10秒のままで、FALLBACK_WAIT_MSでは返らない", async () => {
      vi.useFakeTimers();
      saveBefore();
      const { client } = makeSupabase(
        { rounds: ok(round), target_faces: ok([]) },
        undefined,
        FETCH_TIMEOUT_MS * 2,
      );
      let settled = false;
      const pending = fetchRoundDetail(client, "round-1").finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - FALLBACK_WAIT_MS);

      await expect(pending).resolves.toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });
  });
});

describe("fetchRoundDetails", () => {
  const UUID_1 = "11111111-1111-4111-8111-111111111111";
  const UUID_2 = "22222222-2222-4222-8222-222222222222";

  it("入力中のラウンドと指定したラウンドを1回の取得で得て、ラウンドIDごとの記録を返す", async () => {
    // Given: 2件のラウンドが返る
    const { client, queries } = makeSupabase({
      rounds: ok([
        { ...round, id: UUID_1, status: "in_progress" },
        { ...round, id: UUID_2 },
      ]),
      target_faces: ok([face("face-1", null)]),
    });

    // When
    const result = await fetchRoundDetails(client, [UUID_2, "not-a-uuid"]);

    // Then: UUIDだけを絞りに使い、ラウンドごとに設定・revision・取得時刻を持つ
    const roundQuery = queries.find((q) => q.table === "rounds");
    expect(roundQuery?.calls).toContainEqual([
      "or",
      [`status.eq.in_progress,id.in.(${UUID_2})`],
    ]);
    expect(roundQuery?.calls).toContainEqual(["is", ["disabled_at", null]]);
    if (result.status !== "ok") throw new Error("not ok");
    expect([...result.data.rounds.keys()]).toEqual([UUID_1, UUID_2]);
    expect(result.data.rounds.get(UUID_1)).toMatchObject({
      status: "in_progress",
      revisions: { round: 3 },
      userId: "user-1",
      startedAt: result.data.startedAt,
    });
  });

  it("指定したラウンドが無ければ、入力中のラウンドだけで絞る", async () => {
    const { client, queries } = makeSupabase({
      rounds: ok([]),
      target_faces: ok([]),
    });

    const result = await fetchRoundDetails(client, []);

    expect(result).toMatchObject({ status: "ok" });
    expect(queries.find((q) => q.table === "rounds")?.calls).toContainEqual([
      "or",
      ["status.eq.in_progress"],
    ]);
  });

  it("セッションが無いときは、取得せずに未認証のerrorを返す", async () => {
    const { client, queries } = makeSupabase(
      { rounds: ok([]), target_faces: ok([]) },
      null,
    );

    const result = await fetchRoundDetails(client, []);

    expect(result).toEqual({ status: "error", message: AUTH_REQUIRED_MESSAGE });
    expect(queries).toEqual([]);
  });

  it("取得に失敗したときは、そのまま返す", async () => {
    const { client } = makeSupabase({
      rounds: failed(0),
      target_faces: ok([]),
    });

    const result = await fetchRoundDetails(client, []);

    expect(result.status).toBe("error");
  });
});
