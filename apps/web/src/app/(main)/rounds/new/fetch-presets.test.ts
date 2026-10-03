import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";
import { FETCH_ERROR_MESSAGE } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { ROUND_PRESET_SELECT } from "../_shared/reference-query-constants";
import { fetchPresets } from "./fetch-presets";

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

function row(id: string, owner_id: string | null, overrides = {}) {
  return {
    id,
    name: id,
    format: "outdoor",
    bow_type: "recurve",
    owner_id,
    created_at: "2026-09-01T00:00:00Z",
    preset_distances: [],
    ...overrides,
  };
}

describe("fetchPresets", () => {
  describe("正常系", () => {
    it("自分の個人プリセットと公式プリセットだけを要求する1回のクエリを、再試行なしで発行する", async () => {
      // Given
      const { client, queries } = makeSupabase(ok([]));

      // When
      await fetchPresets(client);

      // Then: 他人の個人プリセットを要求せず、RLSが全行を返すことに頼らない
      expect(queries).toEqual([
        {
          table: "preset_rounds",
          calls: [
            ["select", [ROUND_PRESET_SELECT]],
            ["or", ["owner_id.is.null,owner_id.eq.user-1"]],
            ["retry", [false]],
          ],
        },
      ]);
    });

    it("owner_idの有無で個人と公式に振り分け、それぞれを構成の順に並べる", async () => {
      // Given
      const { client } = makeSupabase(
        ok([
          row("global-field", null, { format: "field" }),
          row("personal-indoor", "user-1", { format: "indoor" }),
          row("global-outdoor", null),
          row("personal-outdoor", "user-1"),
        ]),
      );

      // When
      const result = await fetchPresets(client);

      // Then
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.data.personal.map((p) => p.id)).toEqual([
        "personal-outdoor",
        "personal-indoor",
      ]);
      expect(result.data.global.map((p) => p.id)).toEqual([
        "global-outdoor",
        "global-field",
      ]);
    });

    it("0件でも、個人・公式ともに空のokとする", async () => {
      const { client } = makeSupabase(ok([]));

      await expect(fetchPresets(client)).resolves.toEqual({
        status: "ok",
        data: { personal: [], global: [] },
      });
    });

    it("データがnullでも空のokとする", async () => {
      const { client } = makeSupabase(ok(null));

      await expect(fetchPresets(client)).resolves.toEqual({
        status: "ok",
        data: { personal: [], global: [] },
      });
    });
  });

  describe("失敗の分類", () => {
    it("オフラインではクエリを発行せずofflineを返す", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { client, queries } = makeSupabase(ok([]));

      await expect(fetchPresets(client)).resolves.toEqual({
        status: "offline",
      });
      expect(queries).toEqual([]);
    });

    it("通信失敗(status 0)はofflineとする", async () => {
      const { client } = makeSupabase({ data: null, error: null, status: 0 });

      await expect(fetchPresets(client)).resolves.toEqual({
        status: "offline",
      });
    });

    it("サーバーエラーは取得エラーとする", async () => {
      const { client } = makeSupabase({
        data: null,
        error: { message: "boom" },
        status: 500,
      });

      await expect(fetchPresets(client)).resolves.toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("セッションが無い場合は、クエリを発行せずサインインが必要なエラーとする", async () => {
      const { client, queries } = makeSupabase(ok([]), null);

      await expect(fetchPresets(client)).resolves.toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(queries).toEqual([]);
    });

    it("取得中にセッションのユーザーIDが失われた場合は、クエリを発行せずサインインが必要なエラーとする", async () => {
      // Given: fetchContentの確認は通り、クエリ直前のセッション取得では無い
      let calls = 0;
      const { client, queries } = makeSupabase(ok([]));
      client.auth.getSession = (async () => {
        calls += 1;
        return {
          data: { session: calls === 1 ? { user: { id: "user-1" } } : null },
        };
      }) as typeof client.auth.getSession;

      // When/Then
      await expect(fetchPresets(client)).resolves.toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(queries).toEqual([]);
    });
  });
});
