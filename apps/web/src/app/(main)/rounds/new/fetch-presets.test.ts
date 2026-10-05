import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";
import {
  FALLBACK_WAIT_MS,
  FETCH_TIMEOUT_MS,
} from "@/features/fetch-result/fetch-content";
import { FETCH_ERROR_MESSAGE } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { ROUND_PRESET_SELECT } from "../_shared/reference-query-constants";
import {
  loadReferenceSnapshot,
  saveReferenceSnapshot,
} from "../_shared/reference-snapshot";
import {
  deletePresetFromSnapshot,
  type FetchedPresets,
  fetchPresets,
} from "./fetch-presets";

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

// Supabaseクライアントは外部サービスとの境界のため、取得結果を返し、組み立てたクエリを記録するスタブで模す。
// クエリビルダーはメソッドチェーンの後にawaitで結果を返すため、任意のメソッドを記録して自身を返し、thenで結果を返すProxyで表す。
function makeSupabase(
  response: Response,
  session: unknown = { user: { id: "user-1" } },
  delayMs = 0,
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
            return (resolve: (value: unknown) => void) => {
              if (delayMs > 0) setTimeout(() => resolve(response), delayMs);
              else resolve(response);
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

    it("通信失敗(status 0)は、原因を断定せずerrorとする", async () => {
      const { client } = makeSupabase({ data: null, error: null, status: 0 });

      await expect(fetchPresets(client)).resolves.toEqual({
        status: "error",
        message: "読み込めませんでした。",
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

  describe("端末への保存", () => {
    const IDENTITY_KEY = "aims:local-user-id";
    const SAVED = {
      personal: [row("saved-personal", "user-1")],
      global: [row("saved-global", null)],
    };
    const ids = (r: Awaited<ReturnType<typeof fetchPresets>>) =>
      r.status === "ok"
        ? [...r.data.personal, ...r.data.global].map((p) => p.id)
        : r.status;

    function savedIds() {
      const saved = loadReferenceSnapshot<FetchedPresets>("presets");
      return saved ? [...saved.personal, ...saved.global].map((p) => p.id) : [];
    }

    function saveBefore() {
      localStorage.setItem(IDENTITY_KEY, "user-1");
      saveReferenceSnapshot("presets", "user-1", SAVED, 1);
    }

    it("okの結果を、クエリのユーザーのキーへ保存する", async () => {
      const { client } = makeSupabase(
        ok([row("p1", "user-1"), row("g1", null)]),
      );

      await fetchPresets(client);

      localStorage.setItem(IDENTITY_KEY, "user-1");
      const saved = loadReferenceSnapshot<{
        personal: { id: string }[];
        global: { id: string }[];
      }>("presets");
      expect(saved?.personal.map((p) => p.id)).toEqual(["p1"]);
      expect(saved?.global.map((p) => p.id)).toEqual(["g1"]);
    });

    it("取得できたときは最新で上書きして返す", async () => {
      saveBefore();
      const { client } = makeSupabase(ok([row("fresh", null)]));

      const result = await fetchPresets(client);

      expect(ids(result)).toEqual(["fresh"]);
      expect(savedIds()).toEqual(["fresh"]);
    });

    it.each([
      [
        "オフライン",
        () => vi.spyOn(navigator, "onLine", "get").mockReturnValue(false),
        ok([]),
      ],
      ["通信失敗", () => {}, { data: null, error: null, status: 0 }],
      [
        "サーバーエラー",
        () => {},
        { data: null, error: { message: "x" }, status: 500 },
      ],
    ])("%sのとき、保存済みがあればそれを返す", async (_n, setup, response) => {
      saveBefore();
      setup();
      const { client } = makeSupabase(response as Response);

      const result = await fetchPresets(client);

      expect(result).toEqual({ status: "ok", data: SAVED });
    });

    it("保存済みが無ければ、今の結果をそのまま返す", async () => {
      localStorage.setItem(IDENTITY_KEY, "user-1");
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { client } = makeSupabase(ok([]));

      await expect(fetchPresets(client)).resolves.toEqual({
        status: "offline",
      });
    });

    it("保存済みがあると、FALLBACK_WAIT_MSで終わらない取得を待たず保存済みを返す", async () => {
      vi.useFakeTimers();
      saveBefore();
      const { client } = makeSupabase(
        ok([row("fresh", null)]),
        undefined,
        5_000,
      );
      const pending = fetchPresets(client);

      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);

      await expect(pending).resolves.toEqual({ status: "ok", data: SAVED });
    });

    it("保存済みが無いと、FALLBACK_WAIT_MSでは返らず、FETCH_TIMEOUT_MSでerrorになる", async () => {
      vi.useFakeTimers();
      const { client } = makeSupabase(ok([]), undefined, FETCH_TIMEOUT_MS * 2);
      let settled = false;
      const pending = fetchPresets(client).finally(() => {
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

    it("時間切れの後に届いたokは表示に使わず、取得の開始時のクエリのユーザーのキーへ保存する", async () => {
      vi.useFakeTimers();
      saveBefore();
      const { client } = makeSupabase(
        ok([row("late", null)]),
        undefined,
        3_000,
      );
      const pending = fetchPresets(client);
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      await expect(pending).resolves.toEqual({ status: "ok", data: SAVED });

      await vi.advanceTimersByTimeAsync(3_000);

      expect(savedIds()).toEqual(["late"]);
    });

    it("取得中に識別が別のユーザーへ変わっても、開始時のユーザーのキーへ保存し、新しいユーザーのキーへは書かない", async () => {
      vi.useFakeTimers();
      saveBefore();
      const { client } = makeSupabase(
        ok([row("late", null)]),
        undefined,
        3_000,
      );
      const pending = fetchPresets(client);
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      await pending;
      localStorage.setItem(IDENTITY_KEY, "user-2");

      await vi.advanceTimersByTimeAsync(3_000);

      expect(loadReferenceSnapshot("presets")).toBeNull();
      localStorage.setItem(IDENTITY_KEY, "user-1");
      expect(savedIds()).toEqual(["late"]);
    });

    it("時間切れの後に届いた結果がok以外なら、保存済みは変わらない", async () => {
      vi.useFakeTimers();
      saveBefore();
      const { client } = makeSupabase(
        { data: null, error: { message: "x" }, status: 500 },
        undefined,
        3_000,
      );
      const pending = fetchPresets(client);
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      await pending;

      await vi.advanceTimersByTimeAsync(3_000);

      expect(loadReferenceSnapshot("presets")).toEqual(SAVED);
    });

    it("deletePresetFromSnapshotで個人から除かれ、削除前に始まった取得の遅れた結果では戻らない", async () => {
      vi.useFakeTimers();
      localStorage.setItem(IDENTITY_KEY, "user-1");
      saveReferenceSnapshot(
        "presets",
        "user-1",
        {
          personal: [row("mine", "user-1"), row("keep", "user-1")],
          global: [],
        },
        1,
      );
      vi.setSystemTime(10_000);
      const { client } = makeSupabase(
        ok([row("mine", "user-1"), row("keep", "user-1")]),
        undefined,
        3_000,
      );
      const pending = fetchPresets(client);
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      await pending;

      deletePresetFromSnapshot("mine");
      await vi.advanceTimersByTimeAsync(3_000);

      const saved = loadReferenceSnapshot<{ personal: { id: string }[] }>(
        "presets",
      );
      expect(saved?.personal.map((p) => p.id)).toEqual(["keep"]);
    });
  });
});
