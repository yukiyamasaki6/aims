import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NewRoundPage from "./page";
import { RoundPresetSelect } from "./round-preset-select-client";

// リクエストのcookieはNext.jsの実行環境が提供するため境界としてモックする。
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

// Supabaseクライアントは外部サービスとの境界のため、getUserとプリセットの取得結果を返し、組み立てたクエリを記録するスタブで模す。
// プリセットは個人分とグローバル分を同じテーブルから取得するため、owner_idの条件で結果を引き分ける。
// クエリビルダーはメソッドチェーンの後にawaitで結果を返すため、任意のメソッドを記録して自身を返し、thenで結果を返すProxyで表す。
const db = vi.hoisted(() => {
  type Call = [method: string, args: unknown[]];
  type Result = { data: unknown; error: unknown };
  const results: { personal?: Result; global?: Result } = {};
  const queries: { table: string; calls: Call[] }[] = [];
  function createQuery(table: string): unknown {
    const calls: Call[] = [];
    queries.push({ table, calls });
    const query: unknown = new Proxy(
      {},
      {
        get(_, method) {
          if (method === "then") {
            const isGlobal = calls.some(
              ([name, [column]]) => name === "is" && column === "owner_id",
            );
            const result = (isGlobal ? results.global : results.personal) ?? {
              data: [],
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
  db.results.personal = undefined;
  db.results.global = undefined;
  db.queries.length = 0;
});

type PresetOverrides = {
  id: string;
  owner_id?: string | null;
  format?: string;
  bow_type?: string;
  created_at?: string;
  distances?: { position_key: string; distance: number | null }[];
};

function preset({
  id,
  owner_id = null,
  format = "outdoor",
  bow_type = "recurve",
  created_at = "2026-09-01T00:00:00Z",
  distances = [{ position_key: "a", distance: 70 }],
}: PresetOverrides) {
  return {
    id,
    name: id,
    format,
    bow_type,
    owner_id,
    created_at,
    preset_distances: distances.map((d, index) => ({
      id: `${id}-distance-${index}`,
      position_key: d.position_key,
      distance: d.distance,
      is_marked: true,
      total_ends: 6,
      arrows_per_end: 6,
      target_faces: null,
    })),
  };
}

function givenPresets({
  personal = [],
  global = [],
}: {
  personal?: ReturnType<typeof preset>[];
  global?: ReturnType<typeof preset>[];
}) {
  db.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  db.results.personal = { data: personal, error: null };
  db.results.global = { data: global, error: null };
}

// ページは非同期のServer Componentで、jsdom上のクライアント描画では実行できないため、プリセット選択のクライアントコンポーネントへ渡す値を検査する。
function presetSelectPropsOf(page: React.ReactElement) {
  expect(page.type).toBe(RoundPresetSelect);
  return page.props as ComponentProps<typeof RoundPresetSelect>;
}

function presetIdsOf(page: React.ReactElement) {
  const { personalPresets, globalPresets } = presetSelectPropsOf(page);
  return {
    personal: personalPresets.map((p) => p.id),
    global: globalPresets.map((p) => p.id),
  };
}

describe("NewRoundPage", () => {
  describe("プリセットの取得", () => {
    it("自分のプリセットを個人分、所有者の無いプリセットをグローバル分として渡す", async () => {
      // Given
      const personal = preset({ id: "personal", owner_id: "user-1" });
      const global = preset({ id: "global" });
      givenPresets({ personal: [personal], global: [global] });

      // When
      const page = await NewRoundPage();

      // Then
      expect(presetSelectPropsOf(page)).toEqual({
        personalPresets: [personal],
        globalPresets: [global],
      });
      expect(db.queries).toEqual([
        {
          table: "preset_rounds",
          calls: [
            [
              "select",
              [
                "id, name, format, bow_type, owner_id, created_at, preset_distances(id, position_key, distance, is_marked, total_ends, arrows_per_end, target_faces(size, target_face_spots(center_x, center_y, target_face_rings(radius, color, line_color, z_index, score_str, score_int))))",
              ],
            ],
            ["eq", ["owner_id", "user-1"]],
          ],
        },
        {
          table: "preset_rounds",
          calls: [
            [
              "select",
              [
                "id, name, format, bow_type, owner_id, created_at, preset_distances(id, position_key, distance, is_marked, total_ends, arrows_per_end, target_faces(size, target_face_spots(center_x, center_y, target_face_rings(radius, color, line_color, z_index, score_str, score_int))))",
              ],
            ],
            ["is", ["owner_id", null]],
          ],
        },
      ]);
    });

    it("サインインしていない場合は、個人分を取得せずグローバル分だけを渡す", async () => {
      // Given
      givenPresets({ global: [preset({ id: "global" })] });
      db.getUser.mockResolvedValue({ data: { user: null } });

      // When
      const page = await NewRoundPage();

      // Then
      expect(db.queries).toHaveLength(1);
      expect(presetIdsOf(page)).toEqual({ personal: [], global: ["global"] });
    });

    it("個人分を取得できなかった場合は、個人分を空として渡す", async () => {
      // Given
      givenPresets({ global: [preset({ id: "global" })] });
      db.results.personal = { data: null, error: { message: "query failed" } };

      // When
      const page = await NewRoundPage();

      // Then
      expect(presetIdsOf(page)).toEqual({ personal: [], global: ["global"] });
    });

    it("グローバル分を取得できなかった場合は、エラーを投げる", async () => {
      // Given
      givenPresets({});
      db.results.global = { data: null, error: new Error("query failed") };

      // When
      const page = NewRoundPage();

      // Then
      await expect(page).rejects.toThrow("query failed");
    });
  });

  describe("プリセットの並び順", () => {
    it("種別をアウトドア・インドア・フィールドの順に並べる", async () => {
      // Given
      givenPresets({
        global: [
          preset({ id: "field", format: "field" }),
          preset({ id: "outdoor", format: "outdoor" }),
          preset({ id: "indoor", format: "indoor" }),
        ],
      });

      // When
      const page = await NewRoundPage();

      // Then
      expect(presetIdsOf(page).global).toEqual(["outdoor", "indoor", "field"]);
    });

    it("同じ種別の中では、弓種をリカーブ・コンパウンド・ベアボウの順に並べる", async () => {
      // Given
      givenPresets({
        global: [
          preset({ id: "barebow", bow_type: "barebow" }),
          preset({ id: "compound", bow_type: "compound" }),
          preset({ id: "recurve", bow_type: "recurve" }),
        ],
      });

      // When
      const page = await NewRoundPage();

      // Then
      expect(presetIdsOf(page).global).toEqual([
        "recurve",
        "compound",
        "barebow",
      ]);
    });

    it("同じ種別・弓種の中では、距離の本数が多い方を上に並べる", async () => {
      // Given
      givenPresets({
        global: [
          preset({
            id: "one",
            distances: [{ position_key: "a", distance: 90 }],
          }),
          preset({
            id: "two",
            distances: [
              { position_key: "a", distance: 30 },
              { position_key: "b", distance: 30 },
            ],
          }),
        ],
      });

      // When
      const page = await NewRoundPage();

      // Then
      expect(presetIdsOf(page).global).toEqual(["two", "one"]);
    });

    it("距離の本数が同じ場合は、並び順の先頭から見て距離が大きい方を上に並べ、距離未設定は最も小さいものとして扱う", async () => {
      // Given
      givenPresets({
        global: [
          preset({
            id: "70-unset",
            distances: [
              { position_key: "a", distance: 70 },
              { position_key: "b", distance: null },
            ],
          }),
          preset({
            id: "70-30",
            // 登録順ではなく並び順の先頭（position_keyの順）から比べる。
            distances: [
              { position_key: "b", distance: 30 },
              { position_key: "a", distance: 70 },
            ],
          }),
          preset({
            id: "70-50",
            distances: [
              { position_key: "a", distance: 70 },
              { position_key: "b", distance: 50 },
            ],
          }),
        ],
      });

      // When
      const page = await NewRoundPage();

      // Then
      expect(presetIdsOf(page).global).toEqual(["70-50", "70-30", "70-unset"]);
    });

    it("構成がすべて同じ場合は、作成日時が新しい方を上に並べる", async () => {
      // Given
      givenPresets({
        personal: [
          preset({
            id: "older",
            owner_id: "user-1",
            created_at: "2026-09-01T00:00:00Z",
          }),
          preset({
            id: "newer",
            owner_id: "user-1",
            created_at: "2026-09-02T00:00:00Z",
          }),
        ],
      });

      // When
      const page = await NewRoundPage();

      // Then
      expect(presetIdsOf(page).personal).toEqual(["newer", "older"]);
    });
  });
});
