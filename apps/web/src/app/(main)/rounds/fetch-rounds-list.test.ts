import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";
import { FETCH_ERROR_MESSAGE } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { fetchRoundsList } from "./fetch-rounds-list";

beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Response = { data: unknown; error: unknown; status: number };
type Call = [method: string, args: unknown[]];

// Supabaseクライアントは外部サービスとの境界のため、取得結果を返し、組み立てたクエリを記録するスタブで模す。
// クエリビルダーはメソッドチェーンの後にawaitで結果を返すため、任意のメソッドを記録して自身を返し、thenで結果を返すProxyで表す。
function makeSupabase(
  response: Response,
  session: unknown = { user: { id: "user-1" } },
) {
  const queries: { table: string; calls: Call[] }[] = [];
  function createQuery(table: string): unknown {
    const calls: Call[] = [];
    queries.push({ table, calls });
    const query: unknown = new Proxy(
      {},
      {
        get(_, method) {
          if (method === "then") {
            return (resolve: (value: unknown) => void) => resolve(response);
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

describe("fetchRoundsList", () => {
  describe("正常系", () => {
    it("削除されていないラウンドを日付の新しい順に、再試行なしで取得する", async () => {
      // Given
      const { client, queries } = makeSupabase(ok([]));

      // When
      await fetchRoundsList(client);

      // Then
      expect(queries).toEqual([
        {
          table: "rounds",
          calls: [
            [
              "select",
              [
                "id, name, round_date, distances(disabled_at, shots(score_int, disabled_at))",
              ],
            ],
            ["is", ["disabled_at", null]],
            ["order", ["round_date", { ascending: false }]],
            ["retry", [false]],
          ],
        },
      ]);
    });

    it("各ラウンドの合計点を、削除されていない距離の削除されていない記録から求める", async () => {
      // Given
      const { client } = makeSupabase(
        ok([
          {
            id: "round-2",
            name: "午後練習",
            round_date: "2026-09-16",
            distances: [
              {
                disabled_at: null,
                shots: [
                  { score_int: 10, disabled_at: null },
                  { score_int: 9, disabled_at: "2026-09-16T10:00:00Z" },
                ],
              },
              {
                disabled_at: "2026-09-16T11:00:00Z",
                shots: [{ score_int: 8, disabled_at: null }],
              },
              {
                disabled_at: null,
                shots: [{ score_int: 7, disabled_at: null }],
              },
            ],
          },
          {
            id: "round-1",
            name: "午前練習",
            round_date: "2026-09-15",
            distances: [],
          },
        ]),
      );

      // When
      const result = await fetchRoundsList(client);

      // Then
      expect(result).toEqual({
        status: "ok",
        data: [
          {
            id: "round-2",
            name: "午後練習",
            roundDate: "2026-09-16",
            total: 17,
          },
          {
            id: "round-1",
            name: "午前練習",
            roundDate: "2026-09-15",
            total: 0,
          },
        ],
      });
    });
  });

  describe("境界", () => {
    it("ラウンドが0件のとき、not-foundではなく空配列のokを返す", async () => {
      // Given
      const { client } = makeSupabase(ok([]));

      // When
      const result = await fetchRoundsList(client);

      // Then
      expect(result).toEqual({ status: "ok", data: [] });
    });
  });

  describe("異常系", () => {
    it("成功でも結果がnullのとき、空配列のokとして扱う", async () => {
      // Given
      const { client } = makeSupabase(ok(null));

      // When
      const result = await fetchRoundsList(client);

      // Then
      expect(result).toEqual({ status: "ok", data: [] });
    });

    it("通信できないとき、原因を断定せずerrorを返す", async () => {
      // Given: 通信失敗はstatus 0で返る
      const { client } = makeSupabase({ data: null, error: null, status: 0 });

      // When
      const result = await fetchRoundsList(client);

      // Then
      expect(result).toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
    });

    it("取得がエラーのとき、errorを返し、一覧は返さない", async () => {
      // Given
      const { client } = makeSupabase({
        data: null,
        error: { message: "query failed" },
        status: 500,
      });

      // When
      const result = await fetchRoundsList(client);

      // Then
      expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
    });

    it("サインインしていないとき、取得せず、サインインが必要なerrorを返す", async () => {
      // Given
      const { client, queries } = makeSupabase(ok([]), null);

      // When
      const result = await fetchRoundsList(client);

      // Then
      expect(result).toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(queries).toEqual([]);
    });
  });
});
