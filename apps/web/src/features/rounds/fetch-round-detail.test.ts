import { AuthApiError, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_WAIT_MS,
  FETCH_TIMEOUT_MS,
} from "@/features/fetch-result/fetch-content";
import { FETCH_ERROR_MESSAGE } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import {
  fetchRoundDetail,
  fetchRoundDetails,
  fetchTargetFaces,
} from "./fetch-round-detail";
import { TARGET_FACE_SELECT } from "./reference-query-constants";
import {
  loadReferenceSnapshot,
  saveReferenceSnapshot,
} from "./reference-snapshot";

const AUTH_REQUIRED_MESSAGE = "サインインが必要です。";

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
  responses: {
    rounds: Response | ((roundsQueryIndex: number) => Response);
    target_faces: Response;
  },
  session: unknown = { user: { id: "user-1" } },
  delayMs = 0,
) {
  const queries: { table: string; calls: Call[] }[] = [];
  let roundsQueryCount = 0;
  function createQuery(table: "rounds" | "target_faces"): unknown {
    const calls: Call[] = [];
    queries.push({ table, calls });
    // roundsは関数で渡すと、組み立てた順(0始まり)ごとに応答を変えられる。
    const source = responses[table];
    const response =
      typeof source === "function" ? source(roundsQueryCount++) : source;
    const query: unknown = new Proxy(
      {},
      {
        get(_, method) {
          if (method === "then") {
            return (resolve: (value: unknown) => void) => {
              if (delayMs > 0) {
                setTimeout(() => resolve(response), delayMs);
              } else {
                resolve(response);
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
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      refreshSession: async () => ({ data: { session }, error: null }),
      signOut: async () => ({ error: null }),
    },
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

function face(id: string, ownerId: string | null, overrides = {}) {
  return {
    id,
    name: id,
    size: 122,
    format: "outdoor",
    bow_type: ["recurve"],
    owner_id: ownerId,
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

      // Then
      // 論理削除された距離・記録は、revisionの判定に使うため取得する。
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
      // Given
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

      // Then
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
      // Given
      const { client } = makeSupabase({
        rounds: ok({ ...round, distances: [] }),
        target_faces: ok([]),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
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
      // Given
      const { client } = makeSupabase({
        rounds: ok(round),
        target_faces: ok(null),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result).toMatchObject({ status: "ok", data: { targetFaces: [] } });
    });
  });

  describe("見つからない場合", () => {
    it("ラウンドがnull（存在しない・権限なし・論理削除済み）なら、的の取得結果によらずnot-foundとする", async () => {
      // Given
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: ok([face("g", null)]),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result).toEqual({ status: "not-found" });
    });
  });

  describe("失敗の分類", () => {
    it("オフラインではクエリを発行せずofflineを返す", async () => {
      // Given
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { client, queries } = makeSupabase({
        rounds: ok(round),
        target_faces: ok([]),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result).toEqual({ status: "offline" });
      expect(queries).toEqual([]);
    });

    it("どちらかの通信が失敗(status 0)したら、もう一方がエラーでも、原因を断定せずerrorとする", async () => {
      // Given
      const { client } = makeSupabase({
        rounds: failed(500, { message: "boom" }),
        target_faces: failed(0),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result).toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
    });

    it("的の通信失敗は、ラウンドが見つからない場合もerrorとし、見つからないと誤判定しない", async () => {
      // Given
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: failed(0),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result).toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
    });

    it("どちらかが401なら、他のエラーより優先して認証の拒否とし、更新が拒否されればサインインが必要なエラーとする", async () => {
      // Given
      const { client } = makeSupabase({
        rounds: failed(500, { message: "boom" }),
        target_faces: failed(401, { message: "jwt" }),
      });
      client.auth.refreshSession = (async () => ({
        data: { user: null, session: null },
        error: new AuthApiError("revoked", 400, "refresh_token_not_found"),
      })) as typeof client.auth.refreshSession;

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result).toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
    });

    it("ラウンドのサーバーエラーは取得エラーとする", async () => {
      // Given
      const { client } = makeSupabase({
        rounds: failed(500, { message: "boom" }),
        target_faces: ok([]),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result).toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("的のサーバーエラーは取得エラーとする", async () => {
      // Given
      const { client } = makeSupabase({
        rounds: ok(round),
        target_faces: failed(500, { message: "boom" }),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result).toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("セッションが無い場合は、クエリを発行せずサインインが必要なエラーとする", async () => {
      // Given
      const { client, queries } = makeSupabase(
        { rounds: ok(round), target_faces: ok([]) },
        null,
      );

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result).toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(queries).toEqual([]);
    });

    it("確かめたセッションのユーザーで絞り、クエリの前にセッションを読み直さない", async () => {
      // Given
      let calls = 0;
      const { client, queries } = makeSupabase({
        rounds: ok(round),
        target_faces: ok([]),
      });
      client.auth.getSession = (async () => {
        calls += 1;
        return {
          data: { session: calls === 1 ? { user: { id: "user-1" } } : null },
          error: null,
        };
      }) as typeof client.auth.getSession;

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result.status).toBe("ok");
      expect(calls).toBe(1);
      expect(
        queries.find((q) => q.table === "target_faces")?.calls,
      ).toContainEqual(["or", ["owner_id.is.null,owner_id.eq.user-1"]]);
    });
  });
});

describe("fetchTargetFaces", () => {
  it("的だけを取得し、共通の的を先に並べて返す", async () => {
    // Given
    const { client, queries } = makeSupabase({
      rounds: ok(null),
      target_faces: ok([face("own", "user-1"), face("common", null)]),
    });

    // When
    const result = await fetchTargetFaces(client);

    // Then
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.map((f) => f.id).sort()).toEqual(["common", "own"]);
    expect(queries.map((q) => q.table)).toEqual(["target_faces"]);
  });

  it("サインインしていない場合は、クエリを発行せずサインインを求める", async () => {
    // Given
    const { client, queries } = makeSupabase(
      { rounds: ok(null), target_faces: ok([]) },
      null,
    );

    // When
    const result = await fetchTargetFaces(client);

    // Then
    expect(result).toEqual({
      status: "error",
      message: AUTH_REQUIRED_MESSAGE,
    });
    expect(queries).toEqual([]);
  });

  it("オフラインではクエリを発行せずofflineを返す", async () => {
    // Given
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { client, queries } = makeSupabase({
      rounds: ok(null),
      target_faces: ok([]),
    });

    // When
    const result = await fetchTargetFaces(client);

    // Then
    expect(result).toEqual({ status: "offline" });
    expect(queries).toEqual([]);
  });

  it("通信が失敗(status 0)したら、そのレスポンスをそのまま返す", async () => {
    // Given
    const { client } = makeSupabase({
      rounds: ok(null),
      target_faces: failed(0),
    });

    // When
    const result = await fetchTargetFaces(client);

    // Then
    expect(result.status).toBe("error");
  });

  it("エラーレスポンスはerrorとして返す", async () => {
    // Given
    const { client } = makeSupabase({
      rounds: ok(null),
      target_faces: failed(500, { message: "boom" }),
    });

    // When
    const result = await fetchTargetFaces(client);

    // Then
    expect(result.status).toBe("error");
  });

  it("データがnullなら空の一覧として返す", async () => {
    // Given
    const { client } = makeSupabase({
      rounds: ok(null),
      target_faces: ok(null),
    });

    // When
    const result = await fetchTargetFaces(client);

    // Then
    expect(result).toEqual({ status: "ok", data: [] });
  });
});

describe("的の端末への保存", () => {
  const identityKey = "aims:local-user-id";
  const savedFaces = [face("saved", null)];
  const idsOf = (faces: unknown) =>
    (faces as { id: string }[]).map((f) => f.id);

  function saveBefore() {
    localStorage.setItem(identityKey, "user-1");
    saveReferenceSnapshot("target-faces", "user-1", savedFaces, 1);
  }

  // 端末の識別によらず、ユーザーのキーに保存された的のIDを読む。
  function storedFaceIds(userId: string): string[] | null {
    const raw = localStorage.getItem(`aims:reference:target-faces:${userId}`);
    return raw === null
      ? null
      : idsOf((JSON.parse(raw) as { data: unknown }).data);
  }

  describe("fetchTargetFaces", () => {
    it("okの結果を並べて、クエリのユーザーのキーへ保存する", async () => {
      // Given
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: ok([face("own", "user-1"), face("common", null)]),
      });

      // When
      await fetchTargetFaces(client);

      // Then
      expect(storedFaceIds("user-1")).toEqual(["own", "common"]);
    });

    it("取得できたときは、保存済みを最新で上書きして返す(サーバーでの変更・削除の反映)", async () => {
      // Given
      saveBefore();
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: ok([face("fresh", null)]),
      });

      // When
      const result = await fetchTargetFaces(client);

      // Then
      expect(result.status === "ok" && idsOf(result.data)).toEqual(["fresh"]);
      expect(idsOf(loadReferenceSnapshot("target-faces"))).toEqual(["fresh"]);
    });

    it.each([
      ["通信失敗", { data: null, error: null, status: 0 }],
      ["サーバーエラー", { data: null, error: { message: "x" }, status: 500 }],
    ])("%sのとき、保存済みがあればそれを返す", async (_n, response) => {
      // Given
      saveBefore();
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: response as Response,
      });

      // When
      const result = await fetchTargetFaces(client);

      // Then
      expect(result).toEqual({ status: "ok", data: savedFaces });
    });

    it("オフラインで保存済みが無ければ、offlineを返す", async () => {
      // Given
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: ok([]),
      });

      // When
      const result = await fetchTargetFaces(client);

      // Then
      expect(result).toEqual({ status: "offline" });
    });

    it("オフラインで保存済みがあれば、それを返す", async () => {
      // Given
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      saveBefore();
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: ok([]),
      });

      // When
      const result = await fetchTargetFaces(client);

      // Then
      expect(result).toEqual({ status: "ok", data: savedFaces });
    });

    it("保存済みがあると、FALLBACK_WAIT_MSで終わらない取得を待たず保存済みを返す", async () => {
      // Given
      vi.useFakeTimers();
      saveBefore();
      const { client } = makeSupabase(
        { rounds: ok(null), target_faces: ok([face("fresh", null)]) },
        undefined,
        5_000,
      );

      // When
      const pending = fetchTargetFaces(client);
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      const result = await pending;

      // Then
      expect(result).toEqual({ status: "ok", data: savedFaces });
    });

    it("保存済みが無いと、FALLBACK_WAIT_MSでは返らず、FETCH_TIMEOUT_MSでerrorになる", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(
        { rounds: ok(null), target_faces: ok([]) },
        undefined,
        FETCH_TIMEOUT_MS * 2,
      );

      // When
      let settled = false;
      const pending = fetchTargetFaces(client).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      const settledAtFallback = settled;
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - FALLBACK_WAIT_MS);
      const result = await pending;

      // Then
      expect(settledAtFallback).toBe(false);
      expect(result).toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("時間切れの後に届いたokは表示に使わず、開始時のユーザーのキーへ保存し、識別が変わっても新しいユーザーのキーへ書かない", async () => {
      // Given
      vi.useFakeTimers();
      saveBefore();
      const { client } = makeSupabase(
        { rounds: ok(null), target_faces: ok([face("late", null)]) },
        undefined,
        3_000,
      );

      // When
      const pending = fetchTargetFaces(client);
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      const shown = await pending;
      localStorage.setItem(identityKey, "user-2");
      await vi.advanceTimersByTimeAsync(3_000);

      // Then
      expect(shown).toEqual({ status: "ok", data: savedFaces });
      expect(storedFaceIds("user-1")).toEqual(["late"]);
      expect(storedFaceIds("user-2")).toBeNull();
    });

    it("時間切れの後に届いた結果がok以外なら、保存済みは変わらない", async () => {
      // Given
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

      // When
      await vi.advanceTimersByTimeAsync(3_000);

      // Then
      expect(loadReferenceSnapshot("target-faces")).toEqual(savedFaces);
    });
  });

  describe("fetchRoundDetail", () => {
    it("okのとき、並べた的をクエリのユーザーのキーへ保存する", async () => {
      // Given
      const { client } = makeSupabase({
        rounds: ok(round),
        target_faces: ok([face("own", "user-1"), face("common", null)]),
      });

      // When
      await fetchRoundDetail(client, "round-1");

      // Then
      expect(storedFaceIds("user-1")).toEqual(["own", "common"]);
    });

    it("失敗のときは、保存済みがあっても代わりにせず、結果をそのまま返す", async () => {
      // Given
      saveBefore();
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { client } = makeSupabase({
        rounds: ok(round),
        target_faces: ok([]),
      });

      // When
      const result = await fetchRoundDetail(client, "round-1");

      // Then
      expect(result).toEqual({ status: "offline" });
      expect(loadReferenceSnapshot("target-faces")).toEqual(savedFaces);
    });

    it("待ちは10秒のままで、FALLBACK_WAIT_MSでは返らない", async () => {
      // Given
      vi.useFakeTimers();
      saveBefore();
      const { client } = makeSupabase(
        { rounds: ok(round), target_faces: ok([]) },
        undefined,
        FETCH_TIMEOUT_MS * 2,
      );

      // When
      let settled = false;
      const pending = fetchRoundDetail(client, "round-1").finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      const settledAtFallback = settled;
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - FALLBACK_WAIT_MS);
      const result = await pending;

      // Then
      expect(settledAtFallback).toBe(false);
      expect(result).toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });
  });
});

describe("fetchRoundDetails", () => {
  const uuid1 = "11111111-1111-4111-8111-111111111111";
  const uuid2 = "22222222-2222-4222-8222-222222222222";

  it("入力中のラウンドと指定したラウンドを1回の取得で得て、ラウンドIDごとの記録を返す", async () => {
    // Given
    const { client, queries } = makeSupabase({
      rounds: ok([
        { ...round, id: uuid1, status: "in_progress" },
        { ...round, id: uuid2 },
      ]),
      target_faces: ok([face("face-1", null)]),
    });

    // When
    const result = await fetchRoundDetails(client, [uuid2, "not-a-uuid"]);

    // Then
    const roundQuery = queries.find((q) => q.table === "rounds");
    expect(roundQuery?.calls).toContainEqual([
      "or",
      [`status.eq.in_progress,id.in.(${uuid2})`],
    ]);
    expect(roundQuery?.calls).toContainEqual(["is", ["disabled_at", null]]);
    if (result.status !== "ok") throw new Error("not ok");
    expect([...result.data.rounds.keys()]).toEqual([uuid1, uuid2]);
    expect(result.data.rounds.get(uuid1)).toMatchObject({
      status: "in_progress",
      revisions: { round: 3 },
      userId: "user-1",
      startedAt: result.data.startedAt,
    });
  });

  it("指定したラウンドが無ければ、入力中のラウンドだけで絞る", async () => {
    // Given
    const { client, queries } = makeSupabase({
      rounds: ok([]),
      target_faces: ok([]),
    });

    // When
    const result = await fetchRoundDetails(client, []);

    // Then
    expect(result).toMatchObject({ status: "ok" });
    expect(queries.find((q) => q.table === "rounds")?.calls).toContainEqual([
      "or",
      ["status.eq.in_progress"],
    ]);
  });

  it("セッションが無いときは、取得せずに未認証のerrorを返す", async () => {
    // Given
    const { client, queries } = makeSupabase(
      { rounds: ok([]), target_faces: ok([]) },
      null,
    );

    // When
    const result = await fetchRoundDetails(client, []);

    // Then
    expect(result).toEqual({ status: "error", message: AUTH_REQUIRED_MESSAGE });
    expect(queries).toEqual([]);
  });

  it("取得に失敗したときは、そのまま返す", async () => {
    // Given
    const { client } = makeSupabase({
      rounds: failed(0),
      target_faces: ok([]),
    });

    // When
    const result = await fetchRoundDetails(client, []);

    // Then
    expect(result.status).toBe("error");
  });

  describe("保持のIDが多いとき", () => {
    const uuidAt = (n: number) =>
      `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const uuids = (count: number) =>
      Array.from({ length: count }, (_, i) => uuidAt(i + 1));
    const roundQueries = (queries: { table: string; calls: Call[] }[]) =>
      queries.filter((q) => q.table === "rounds");
    const idsIn = (calls: Call[]) => {
      const inCall = calls.find(([m]) => m === "in");
      if (inCall) return inCall[1][1] as string[];
      const orCall = calls.find(([m]) => m === "or");
      const orFilter = String(orCall?.[1][0]);
      const listed = orFilter.split("id.in.(")[1];
      return listed ? listed.replace(")", "").split(",") : [];
    };

    it("50件までは1回の取得で、51件目から取得が増え、2回目以降は入力中を除く", async () => {
      // Given
      // When
      const queriesOf: Record<number, { table: string; calls: Call[] }[]> = {};
      for (const n of [0, 50, 51]) {
        const { client, queries } = makeSupabase({
          rounds: ok([]),
          target_faces: ok([]),
        });
        await fetchRoundDetails(client, uuids(n));
        queriesOf[n] = roundQueries(queries);
      }

      // Then
      expect(
        Object.fromEntries(
          Object.entries(queriesOf).map(([n, q]) => [n, q.length]),
        ),
      ).toEqual({ 0: 1, 50: 1, 51: 2 });
      expect(queriesOf[50][0].calls).toContainEqual([
        "or",
        [`status.eq.in_progress,id.in.(${uuids(50).join(",")})`],
      ]);
      const second = queriesOf[51][1].calls;
      expect(second).toContainEqual(["neq", ["status", "in_progress"]]);
      expect(second).toContainEqual(["in", ["id", [uuidAt(51)]]]);
    });

    it("300件では、取得が6回に分かれ、各取得のIDは50件以下で、全IDが重複なく1回ずつ含まれる", async () => {
      // Given
      const { client, queries } = makeSupabase({
        rounds: ok([]),
        target_faces: ok([]),
      });
      const all = uuids(300);

      // When
      const result = await fetchRoundDetails(client, all);

      // Then
      expect(result.status).toBe("ok");
      const sent = roundQueries(queries).map((q) => idsIn(q.calls));
      expect(sent).toHaveLength(6);
      for (const ids of sent) expect(ids.length).toBeLessThanOrEqual(50);
      expect(sent.flat()).toEqual(all);
    });

    it("各取得のIDの文字列は、確認済みの長さ(3755バイト)を下回る", async () => {
      // Given
      const { client, queries } = makeSupabase({
        rounds: ok([]),
        target_faces: ok([]),
      });

      // When
      await fetchRoundDetails(client, uuids(300));

      // Then
      for (const q of roundQueries(queries)) {
        const encoded = encodeURIComponent(idsIn(q.calls).join(","));
        expect(encoded.length).toBeLessThan(3755);
      }
    });

    it("UUIDでないIDは件数に数えず、取得にも含めない", async () => {
      // Given
      const junk = Array.from({ length: 10 }, (_, i) => `bad-${i}`);
      const { client, queries } = makeSupabase({
        rounds: ok([]),
        target_faces: ok([]),
      });

      // When
      await fetchRoundDetails(client, [...junk, ...uuids(50)]);

      // Then
      expect(roundQueries(queries)).toHaveLength(1);
    });

    it("複数の取得の行を1つにまとめ、同じIDはrevisionが大きい行を使う", async () => {
      // Given
      const dup = uuidAt(51);
      const { client } = makeSupabase({
        rounds: (i) =>
          i === 0
            ? ok([
                { ...round, id: uuidAt(1), status: "in_progress" },
                { ...round, id: dup, revision: 3 },
              ])
            : ok([{ ...round, id: dup, revision: 9 }]),
        target_faces: ok([]),
      });

      // When
      const result = await fetchRoundDetails(client, uuids(51));

      // Then
      if (result.status !== "ok") throw new Error("not ok");
      expect([...result.data.rounds.keys()].sort()).toEqual([uuidAt(1), dup]);
      expect(result.data.rounds.get(dup)?.revisions.round).toBe(9);
    });

    it("2回目以降の取得だけが失敗したら、全体を失敗とし、的を保存しない", async () => {
      // Given
      localStorage.setItem("aims:local-user-id", "user-1");
      const { client } = makeSupabase({
        rounds: (i) => (i === 1 ? failed(0) : ok([])),
        target_faces: ok([face("face-1", null)]),
      });

      // When
      const result = await fetchRoundDetails(client, uuids(51));

      // Then
      expect(result.status).toBe("error");
      expect(loadReferenceSnapshot("target-faces")).toBeNull();
    });

    it("取得の1つがerrorを返したら、全体を失敗とする", async () => {
      // Given
      const { client } = makeSupabase({
        rounds: (i) => (i === 2 ? failed(500, { message: "x" }) : ok([])),
        target_faces: ok([]),
      });

      // When
      const result = await fetchRoundDetails(client, uuids(120));

      // Then
      expect(result.status).toBe("error");
    });
  });
});
