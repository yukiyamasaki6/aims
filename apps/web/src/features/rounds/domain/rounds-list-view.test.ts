import { describe, expect, it } from "vitest";
import type { FetchView } from "./fetch-status";
import type {
  LoadedRoundsList,
  LocalRoundsList,
  RoundListItem,
} from "./round-list";
import { historyView, homeView } from "./rounds-list-view";

function item(id: string, roundDate = "2026-09-15", total = 0): RoundListItem {
  return { id, name: id, roundDate, total };
}

const ids = (rounds: RoundListItem[] | null | undefined) =>
  rounds?.map((r) => r.id);

describe("homeView", () => {
  it("端末の入力中のラウンドを実施日の新しい順に返す", () => {
    // Given
    const local: LocalRoundsList = {
      inProgress: [
        item("old", "2026-09-01"),
        item("new", "2026-09-20"),
        item("mid", "2026-09-10"),
      ],
    };

    // When
    const result = homeView(local, new Set());

    // Then
    expect(ids(result)).toEqual(["new", "mid", "old"]);
  });

  it("この画面で削除したラウンドを除く", () => {
    // Given
    const local: LocalRoundsList = {
      inProgress: [item("a"), item("b")],
    };

    // When
    const result = homeView(local, new Set(["a"]));

    // Then
    expect(ids(result)).toEqual(["b"]);
  });

  it("入力中が0件なら空の配列を返す", () => {
    // Given
    const local: LocalRoundsList = { inProgress: [] };

    // When
    const result = homeView(local, new Set());

    // Then
    expect(result).toEqual([]);
  });

  it("端末の入力中をまだ読んでいなければ、何も出さない(null)", () => {
    // Given

    // When
    const result = homeView(null, new Set());

    // Then
    expect(result).toBeNull();
  });
});

describe("historyView", () => {
  const loaded = (
    overrides: Partial<LoadedRoundsList> = {},
  ): FetchView<LoadedRoundsList> => ({
    status: "ok",
    data: { items: [], deleted: new Set(), ...overrides },
  });
  const empty: LocalRoundsList = { inProgress: [] };

  it("取得が成功したら、取得の順のまま返し、取得の状態は返さない", () => {
    // Given

    // When
    const view = historyView(
      loaded({
        items: [
          item("c", "2026-09-01"),
          item("a", "2026-09-20"),
          item("b", "2026-09-10"),
        ],
      }),
      empty,
      new Set(),
    );

    // Then
    expect(ids(view.rounds)).toEqual(["c", "a", "b"]);
    expect(view.rest).toBeNull();
  });

  it("端末の入力中のIDと同じラウンドを除く", () => {
    // Given
    const local: LocalRoundsList = { inProgress: [item("p1")] };

    // When
    const view = historyView(
      loaded({ items: [item("a"), item("p1")] }),
      local,
      new Set(),
    );

    // Then
    expect(ids(view.rounds)).toEqual(["a"]);
  });

  it("取得時に求めた削除済みのIDと、この画面で削除したラウンドを除く", () => {
    // Given

    // When
    const view = historyView(
      loaded({
        items: [item("a"), item("b"), item("c")],
        deleted: new Set(["b"]),
      }),
      empty,
      new Set(["c"]),
    );

    // Then
    expect(ids(view.rounds)).toEqual(["a"]);
  });

  it("取得が成功し、除いた結果が0件なら、空の配列を返す", () => {
    // Given

    // When
    const view = historyView(loaded(), empty, new Set());

    // Then
    expect(view).toEqual({ rounds: [], rest: null });
  });

  it("取得が成功しても、端末の入力中をまだ読んでいなければ、ラウンドを出さず取得中として返す", () => {
    // Given

    // When
    const view = historyView(loaded({ items: [item("a")] }), null, new Set());

    // Then
    expect(view).toEqual({ rounds: null, rest: { status: "loading" } });
  });

  it.each([
    ["loading", { status: "loading" }],
    ["offline", { status: "offline" }],
    ["error", { status: "error", reason: "failed" }],
  ] as const)(
    "取得が%sなら、ラウンドを出さず取得の状態だけを返す",
    (_name, fetchView) => {
      // Given
      const local: LocalRoundsList = { inProgress: [item("p1")] };

      // When
      const view = historyView(fetchView, local, new Set());

      // Then
      expect(view.rounds).toBeNull();
      expect(view.rest).toBe(fetchView);
    },
  );
});
