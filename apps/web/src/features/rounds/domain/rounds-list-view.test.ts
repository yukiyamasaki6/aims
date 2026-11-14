import { describe, expect, it } from "vitest";
import type { FetchView } from "./fetch-status";
import { DEFAULT_HISTORY_CONDITION } from "./history-view-state";
import type {
  DistanceListItem,
  LoadedRoundsList,
  LocalRoundsList,
  RoundListItem,
} from "./round-list";
import { historyView, homeView } from "./rounds-list-view";

function item(id: string, roundDate = "2026-09-15", total = 0): RoundListItem {
  return { id, name: id, roundDate, total };
}

function distanceItem(
  id: string,
  roundId: string,
  number: number,
): DistanceListItem {
  return {
    ...item(id),
    roundId,
    number,
    distance: 50,
    isMarked: true,
  };
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
    data: {
      items: [],
      hasMore: false,
      after: null,
      deleted: new Set(),
      ...overrides,
    },
  });
  const empty: LocalRoundsList = { inProgress: [] };

  it("取得が成功したら、サーバーが返した並びのまま返し、取得の状態は返さない", () => {
    // Given
    // 日付の降順でも得点の順でもない並びで、並べ直さないことを見分ける。
    const items = [
      item("c", "2026-09-01", 300),
      item("a", "2026-09-20", 100),
      item("b", "2026-09-10", 200),
    ];

    // When
    const view = historyView(
      loaded({ items }),
      empty,
      new Set(),
      DEFAULT_HISTORY_CONDITION,
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
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(ids(view.rounds)).toEqual(["a"]);
  });

  it("取得時に求めた削除済みのIDと、この画面で削除したラウンドを除き、残りの並びを保つ", () => {
    // Given

    // When
    const view = historyView(
      loaded({
        items: [item("d"), item("a"), item("b"), item("c")],
        deleted: new Set(["b"]),
      }),
      empty,
      new Set(["c"]),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(ids(view.rounds)).toEqual(["d", "a"]);
  });

  it("続きの有無を返す", () => {
    // Given
    const withMore = loaded({ items: [item("a")], hasMore: true });
    const withoutMore = loaded({ items: [item("a")], hasMore: false });

    // When
    const more = historyView(
      withMore,
      empty,
      new Set(),
      DEFAULT_HISTORY_CONDITION,
    );
    const last = historyView(
      withoutMore,
      empty,
      new Set(),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(more.hasMore).toBe(true);
    expect(last.hasMore).toBe(false);
  });

  it("距離単位では、端末の入力中・削除済み・この画面で削除したラウンドに属する距離を全て除き、他のラウンドの距離と並びは残す", () => {
    // Given
    const items = [
      distanceItem("d-1", "r-keep", 1),
      distanceItem("d-2", "p1", 1),
      distanceItem("d-3", "r-deleted", 1),
      distanceItem("d-4", "r-removed", 1),
      distanceItem("d-5", "r-keep", 2),
      distanceItem("d-6", "p1", 2),
    ];
    const local: LocalRoundsList = { inProgress: [item("p1")] };

    // When
    const view = historyView(
      loaded({ items, deleted: new Set(["r-deleted"]) }),
      local,
      new Set(["r-removed"]),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(ids(view.rounds)).toEqual(["d-1", "d-5"]);
  });

  it("距離単位で、除いた結果が0件でも続きがあれば、0件の配列と続きの有無を返す", () => {
    // Given
    const local: LocalRoundsList = { inProgress: [item("p1")] };

    // When
    const view = historyView(
      loaded({ items: [distanceItem("d-1", "p1", 1)], hasMore: true }),
      local,
      new Set(),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(view).toEqual({ rounds: [], hasMore: true, rest: null });
  });

  it("除いた結果が0件でも、続きがあれば0件の配列と続きの有無を返す(空とは区別できる)", () => {
    // Given
    const local: LocalRoundsList = { inProgress: [item("p1")] };

    // When
    const view = historyView(
      loaded({ items: [item("p1")], hasMore: true }),
      local,
      new Set(),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(view).toEqual({ rounds: [], hasMore: true, rest: null });
  });

  it("取得が成功し、続きがなく0件なら、空の配列を返す", () => {
    // Given

    // When
    const view = historyView(
      loaded(),
      empty,
      new Set(),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(view).toEqual({ rounds: [], hasMore: false, rest: null });
  });

  it("取得が成功しても、端末の入力中をまだ読んでいなければ、ラウンドを出さず取得中として返す", () => {
    // Given

    // When
    const view = historyView(
      loaded({ items: [item("a")] }),
      null,
      new Set(),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(view).toEqual({
      rounds: null,
      hasMore: false,
      rest: { status: "loading" },
    });
  });

  it("取得が成功しても、保存した条件をまだ読んでいなければ、ラウンドを出さず取得中として返す", () => {
    // Given

    // When
    const view = historyView(
      loaded({ items: [item("a")] }),
      empty,
      new Set(),
      null,
    );

    // Then
    expect(view).toEqual({
      rounds: null,
      hasMore: false,
      rest: { status: "loading" },
    });
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
      const view = historyView(
        fetchView,
        local,
        new Set(),
        DEFAULT_HISTORY_CONDITION,
      );

      // Then
      expect(view.rounds).toBeNull();
      expect(view.rest).toBe(fetchView);
    },
  );
});
