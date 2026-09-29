import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RoundPage from "./page";
import { ScorecardClient } from "./scorecard-client";

// notFoundはNext.jsの実行環境が処理する例外を投げて描画を打ち切るため、境界として同じく例外を投げるスタブで模す。
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => navigation);

// リクエストのcookieはNext.jsの実行環境が提供するため境界としてモックする。
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

// Supabaseクライアントは外部サービスとの境界のため、getUserとテーブルごとの取得結果を返し、組み立てたクエリを記録するスタブで模す。
// target_facesは個人分とグローバル分を同じテーブルから取得するため、owner_idの条件で結果を引き分ける。
// クエリビルダーはメソッドチェーンの後にawaitで結果を返すため、任意のメソッドを記録して自身を返し、thenで結果を返すProxyで表す。
const db = vi.hoisted(() => {
  type Call = [method: string, args: unknown[]];
  type Result = { data: unknown; error: unknown };
  const results = new Map<string, Result>();
  const queries: { table: string; calls: Call[] }[] = [];
  function resultKeyOf(table: string, calls: Call[]) {
    if (table !== "target_faces") return table;
    const ownerFilter = calls.find(([, [column]]) => column === "owner_id");
    return ownerFilter?.[0] === "is" ? "target_faces:global" : table;
  }
  function createQuery(table: string): unknown {
    const calls: Call[] = [];
    queries.push({ table, calls });
    const query: unknown = new Proxy(
      {},
      {
        get(_, method) {
          if (method === "then") {
            const result = results.get(resultKeyOf(table, calls)) ?? {
              data: null,
              error: null,
            };
            return (resolve: (value: unknown) => void) => resolve(result);
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
  return { getUser: vi.fn(), results, queries, createQuery };
});
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: db.getUser },
    from: db.createQuery,
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
  db.results.clear();
  db.queries.length = 0;
});

const round = {
  id: "round-1",
  name: "午前練習",
  round_date: "2026-09-15",
  format: "outdoor",
  bow_type: "recurve",
};

const distanceA = {
  id: "distance-a",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-global",
  is_marked: true,
};

const distanceB = { ...distanceA, id: "distance-b", position_key: "b" };

const shot = {
  distance_id: distanceA.id,
  end_number: 1,
  arrow_number: 1,
  shooter_id: "user-1",
  score_str: "X",
  score_int: 10,
};

const personalFace = { id: "face-personal", name: "個人の的" };
const globalFace = { id: "face-global", name: "122cm的" };

function givenRound() {
  db.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  db.results.set("rounds", { data: round, error: null });
  db.results.set("distances", { data: [distanceA, distanceB], error: null });
  db.results.set("shots", { data: [shot], error: null });
  db.results.set("target_faces", { data: [personalFace], error: null });
  db.results.set("target_faces:global", { data: [globalFace], error: null });
}

function renderPage(id = "round-1") {
  return RoundPage({ params: Promise.resolve({ id }) });
}

// ページは非同期のServer Componentで、jsdom上のクライアント描画では実行できないため、スコアカードのクライアントコンポーネントへ渡す値を検査する。
function scorecardPropsOf(page: React.ReactElement) {
  expect(page.type).toBe(ScorecardClient);
  return page.props as ComponentProps<typeof ScorecardClient>;
}

function callsTo(table: string) {
  return db.queries.filter((query) => query.table === table);
}

describe("RoundPage", () => {
  describe("ラウンドがある場合", () => {
    it("ラウンドの設定・距離・記録・個人とグローバルの的をスコアカードへ渡す", async () => {
      // Given
      givenRound();

      // When
      const page = await renderPage();

      // Then
      expect(scorecardPropsOf(page)).toEqual({
        roundId: "round-1",
        initialRoundConfig: {
          name: "午前練習",
          roundDate: "2026-09-15",
          format: "outdoor",
          bowType: "recurve",
        },
        distances: [distanceA, distanceB],
        initialShots: [shot],
        targetFaces: [personalFace, globalFace],
      });
    });

    it("指定したIDの削除されていないラウンド・距離と、その距離の削除されていない記録・自分の的を取得する", async () => {
      // Given
      givenRound();

      // When
      await renderPage();

      // Then
      expect(callsTo("rounds")[0].calls).toEqual([
        ["select", ["id, name, round_date, format, bow_type"]],
        ["eq", ["id", "round-1"]],
        ["is", ["disabled_at", null]],
        ["maybeSingle", []],
      ]);
      expect(callsTo("distances")[0].calls).toEqual([
        [
          "select",
          [
            "id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked",
          ],
        ],
        ["eq", ["round_id", "round-1"]],
        ["is", ["disabled_at", null]],
        ["order", ["position_key"]],
        ["order", ["id"]],
      ]);
      expect(callsTo("shots")[0].calls).toEqual([
        [
          "select",
          [
            "distance_id, end_number, arrow_number, shooter_id, score_str, score_int",
          ],
        ],
        ["in", ["distance_id", ["distance-a", "distance-b"]]],
        ["is", ["disabled_at", null]],
      ]);
      expect(callsTo("target_faces")[0].calls).toEqual([
        [
          "select",
          [
            "id, name, size, format, bow_type, owner_id, target_face_spots(center_x, center_y, target_face_rings(radius, color, line_color, z_index, score_str, score_int))",
          ],
        ],
        ["eq", ["owner_id", "user-1"]],
      ]);
    });

    it("距離が無い場合は、記録を取得せず空の記録を渡す", async () => {
      // Given
      givenRound();
      db.results.set("distances", { data: [], error: null });

      // When
      const page = await renderPage();

      // Then
      expect(callsTo("shots")).toEqual([]);
      expect(scorecardPropsOf(page)).toMatchObject({
        distances: [],
        initialShots: [],
      });
    });

    it("サインインしていない場合は、個人の的を取得せずグローバルの的だけを渡す", async () => {
      // Given
      givenRound();
      db.getUser.mockResolvedValue({ data: { user: null } });

      // When
      const page = await renderPage();

      // Then
      expect(
        callsTo("target_faces").filter(({ calls }) =>
          calls.some(([method]) => method === "eq"),
        ),
      ).toEqual([]);
      expect(scorecardPropsOf(page).targetFaces).toEqual([globalFace]);
    });

    it("距離を取得できなかった場合は、記録を取得せず距離と記録を空として渡す", async () => {
      // Given
      givenRound();
      db.results.set("distances", {
        data: null,
        error: { message: "query failed" },
      });

      // When
      const page = await renderPage();

      // Then
      expect(callsTo("shots")).toEqual([]);
      expect(scorecardPropsOf(page)).toMatchObject({
        distances: [],
        initialShots: [],
      });
    });

    it("記録・個人の的を取得できなかった場合は、それぞれ空として渡す", async () => {
      // Given
      givenRound();
      db.results.set("shots", {
        data: null,
        error: { message: "query failed" },
      });
      db.results.set("target_faces", {
        data: null,
        error: { message: "query failed" },
      });

      // When
      const page = await renderPage();

      // Then
      expect(scorecardPropsOf(page)).toMatchObject({
        initialShots: [],
        targetFaces: [globalFace],
      });
    });

    it("グローバルの的を取得できなかった場合は、エラーを投げる", async () => {
      // Given
      givenRound();
      db.results.set("target_faces:global", {
        data: null,
        error: new Error("query failed"),
      });

      // When
      const page = renderPage();

      // Then
      await expect(page).rejects.toThrow("query failed");
    });
  });

  describe("ラウンドが無い場合", () => {
    it("404を表示し、記録を取得しない", async () => {
      // Given
      givenRound();
      db.results.set("rounds", { data: null, error: null });

      // When
      const page = renderPage("missing-round");

      // Then
      await expect(page).rejects.toThrow("NEXT_NOT_FOUND");
      expect(navigation.notFound).toHaveBeenCalledTimes(1);
      expect(callsTo("shots")).toEqual([]);
    });
  });
});
