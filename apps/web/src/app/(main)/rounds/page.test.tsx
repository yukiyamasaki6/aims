import { Children, isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RoundsPage from "./page";
import { type RoundListItem, RoundsListClient } from "./rounds-list-client";

// リクエストのcookieはNext.jsの実行環境が提供するため境界としてモックする。
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

// Supabaseクライアントは外部サービスとの境界のため、テーブルごとの取得結果を返し、組み立てたクエリを記録するスタブで模す。
// クエリビルダーはメソッドチェーンの後にawaitで結果を返すため、任意のメソッドを記録して自身を返し、thenで結果を返すProxyで表す。
const db = vi.hoisted(() => {
  type Call = [method: string, args: unknown[]];
  const results = new Map<string, { data: unknown; error: unknown }>();
  const queries: { table: string; calls: Call[] }[] = [];
  function createQuery(table: string): unknown {
    const calls: Call[] = [];
    queries.push({ table, calls });
    const query: unknown = new Proxy(
      {},
      {
        get(_, method) {
          if (method === "then") {
            const result = results.get(table) ?? { data: null, error: null };
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
  return { results, queries, createQuery };
});
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ from: db.createQuery }),
}));

afterEach(() => {
  db.results.clear();
  db.queries.length = 0;
});

// ページは非同期のServer Componentで、jsdom上のクライアント描画では実行できないため、一覧のクライアントコンポーネントへ渡す値を検査する。
function initialRoundsOf(
  page: React.ReactElement<{ children: React.ReactNode }>,
) {
  const list = Children.toArray(page.props.children).find(
    (child) => isValidElement(child) && child.type === RoundsListClient,
  );
  if (!isValidElement<{ initialRounds: RoundListItem[] }>(list)) {
    throw new Error("RoundsListClientが含まれていません。");
  }
  return list.props.initialRounds;
}

describe("RoundsPage", () => {
  it("削除されていないラウンドを日付の新しい順に取得する", async () => {
    // Given
    db.results.set("rounds", { data: [], error: null });

    // When
    await RoundsPage();

    // Then
    expect(db.queries).toEqual([
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
        ],
      },
    ]);
  });

  it("各ラウンドの合計点を、削除されていない距離の削除されていない記録から求めて一覧へ渡す", async () => {
    // Given
    db.results.set("rounds", {
      data: [
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
      ],
      error: null,
    });

    // When
    const page = await RoundsPage();

    // Then
    expect(initialRoundsOf(page)).toEqual([
      { id: "round-2", name: "午後練習", roundDate: "2026-09-16", total: 17 },
      { id: "round-1", name: "午前練習", roundDate: "2026-09-15", total: 0 },
    ]);
  });

  it("ラウンドを取得できなかった場合は、空の一覧を渡す", async () => {
    // Given
    db.results.set("rounds", {
      data: null,
      error: { message: "query failed" },
    });

    // When
    const page = await RoundsPage();

    // Then
    expect(initialRoundsOf(page)).toEqual([]);
  });
});
