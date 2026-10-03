import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";
import { FETCH_ERROR_MESSAGE } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { TARGET_FACE_SELECT } from "../_shared/reference-query-constants";
import { fetchRoundDetail } from "./fetch-round-detail";

beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Response = { data: unknown; error: unknown; status: number };
type Call = [method: string, args: unknown[]];

// Supabaseクライアントは外部サービスとの境界のため、テーブルごとの取得結果を返し、組み立てたクエリを記録するスタブで模す。
// クエリビルダーはメソッドチェーンの後にawaitで結果を返すため、任意のメソッドを記録して自身を返し、thenで結果を返すProxyで表す。
function makeSupabase(
  responses: { rounds: Response; target_faces: Response },
  session: unknown = { user: { id: "user-1" } },
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
            return (resolve: (value: unknown) => void) =>
              resolve(responses[table]);
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
  distance_id: "d-a",
  end_number: 1,
  arrow_number: 1,
  shooter_id: "user-1",
  score_str: "X",
  score_int: 10,
};
const shotB = { ...shotA, distance_id: "d-b", score_str: "9", score_int: 9 };

const round = {
  id: "round-1",
  name: "午前練習",
  round_date: "2026-09-15",
  format: "outdoor",
  bow_type: "recurve",
  distances: [
    { ...distanceA, shots: [shotA] },
    { ...distanceB, shots: [shotB] },
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

      // Then: 論理削除された距離・記録を除き、他人の個人の的を要求しない
      expect(queries).toEqual([
        {
          table: "rounds",
          calls: [
            [
              "select",
              [
                "id, name, round_date, format, bow_type, distances(id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, shots(distance_id, end_number, arrow_number, shooter_id, score_str, score_int))",
              ],
            ],
            ["eq", ["id", "round-1"]],
            ["is", ["disabled_at", null]],
            ["is", ["distances.disabled_at", null]],
            ["is", ["distances.shots.disabled_at", null]],
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
          roundConfig: {
            name: "午前練習",
            roundDate: "2026-09-15",
            format: "outdoor",
            bowType: "recurve",
          },
          distances: [distanceA, distanceB],
          shots: [shotA, shotB],
          targetFaces: [],
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

    it("どちらかの通信が失敗(status 0)したら、もう一方がエラーでもofflineとする", async () => {
      const { client } = makeSupabase({
        rounds: failed(500, { message: "boom" }),
        target_faces: failed(0),
      });

      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "offline",
      });
    });

    it("的の通信失敗は、ラウンドが見つかった場合もofflineとし、見つからないと誤判定しない", async () => {
      const { client } = makeSupabase({
        rounds: ok(null),
        target_faces: failed(0),
      });

      await expect(fetchRoundDetail(client, "round-1")).resolves.toEqual({
        status: "offline",
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
