import { describe, expect, it } from "vitest";
import type { FetchView } from "./fetch-status";
import {
  DEFAULT_HISTORY_CONDITION,
  type HistoryCondition,
} from "./history-view-state";
import type {
  HistoryRoundItem,
  LoadedRoundsList,
  LocalRoundsList,
  RoundListItem,
} from "./round-list";
import { historyView, homeView } from "./rounds-list-view";

function item(id: string, roundDate = "2026-09-15", total = 0): RoundListItem {
  return { id, name: id, roundDate, total };
}

function historyItem(
  id: string,
  overrides: Partial<HistoryRoundItem> = {},
): HistoryRoundItem {
  return {
    ...item(id),
    format: "outdoor",
    bowType: "recurve",
    createdAt: "2026-09-15T10:00:00.000000+00:00",
    ...overrides,
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
    data: { items: [], deleted: new Set(), ...overrides },
  });
  const empty: LocalRoundsList = { inProgress: [] };
  const scoreAscending: HistoryCondition = {
    ...DEFAULT_HISTORY_CONDITION,
    sortKey: "score",
    sortDirection: "asc",
  };

  it("取得が成功したら、条件の並びで返し、取得の状態は返さない", () => {
    // Given

    // When
    const view = historyView(
      loaded({
        items: [
          historyItem("c", { roundDate: "2026-09-01" }),
          historyItem("a", { roundDate: "2026-09-20" }),
          historyItem("b", { roundDate: "2026-09-10" }),
        ],
      }),
      empty,
      new Set(),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(ids(view.rounds)).toEqual(["a", "b", "c"]);
    expect(view.rest).toBeNull();
  });

  it("端末の入力中のIDと同じラウンドを除く", () => {
    // Given
    const local: LocalRoundsList = { inProgress: [item("p1")] };

    // When
    const view = historyView(
      loaded({ items: [historyItem("a"), historyItem("p1")] }),
      local,
      new Set(),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(ids(view.rounds)).toEqual(["a"]);
  });

  it("取得時に求めた削除済みのIDと、この画面で削除したラウンドを除く", () => {
    // Given

    // When
    const view = historyView(
      loaded({
        items: [historyItem("a"), historyItem("b"), historyItem("c")],
        deleted: new Set(["b"]),
      }),
      empty,
      new Set(["c"]),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(ids(view.rounds)).toEqual(["a"]);
  });

  it("取得が成功し、除いた結果が0件なら、空の配列を返す", () => {
    // Given

    // When
    const view = historyView(
      loaded(),
      empty,
      new Set(),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(view).toEqual({ rounds: [], rest: null });
  });

  it("取得が成功しても、端末の入力中をまだ読んでいなければ、ラウンドを出さず取得中として返す", () => {
    // Given

    // When
    const view = historyView(
      loaded({ items: [historyItem("a")] }),
      null,
      new Set(),
      DEFAULT_HISTORY_CONDITION,
    );

    // Then
    expect(view).toEqual({ rounds: null, rest: { status: "loading" } });
  });

  it("取得が成功しても、保存した条件をまだ読んでいなければ、ラウンドを出さず取得中として返す", () => {
    // Given

    // When
    const view = historyView(
      loaded({ items: [historyItem("a")] }),
      empty,
      new Set(),
      null,
    );

    // Then
    expect(view).toEqual({ rounds: null, rest: { status: "loading" } });
  });

  it("入力中のIDと削除済みのIDの行は、条件に一致していても除き、条件に一致する行を条件の並びで返す", () => {
    // Given
    const local: LocalRoundsList = { inProgress: [item("in-progress")] };
    const matching = { format: "indoor", bowType: "compound" };
    const indoorCompound: HistoryCondition = {
      ...scoreAscending,
      format: "indoor",
      bowType: "compound",
    };

    // When
    const view = historyView(
      loaded({
        items: [
          historyItem("high", { ...matching, total: 600 }),
          historyItem("in-progress", { ...matching, total: 100 }),
          historyItem("low", { ...matching, total: 300 }),
          historyItem("deleted-on-server", { ...matching, total: 200 }),
          historyItem("removed-here", { ...matching, total: 250 }),
          historyItem("other-format", { format: "outdoor", total: 50 }),
        ],
        deleted: new Set(["deleted-on-server"]),
      }),
      local,
      new Set(["removed-here"]),
      indoorCompound,
    );

    // Then
    expect(ids(view.rounds)).toEqual(["low", "high"]);
  });

  it("条件を選んだ状態で削除したラウンドは、条件に一致する表示から消える", () => {
    // Given
    const items = [
      historyItem("keep", { format: "indoor", total: 500 }),
      historyItem("delete", { format: "indoor", total: 400 }),
    ];
    const indoorOnly: HistoryCondition = {
      ...DEFAULT_HISTORY_CONDITION,
      format: "indoor",
    };

    // When
    const view = historyView(
      loaded({ items }),
      empty,
      new Set(["delete"]),
      indoorOnly,
    );

    // Then
    expect(ids(view.rounds)).toEqual(["keep"]);
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
      const view = historyView(fetchView, local, new Set(), scoreAscending);

      // Then
      expect(view.rounds).toBeNull();
      expect(view.rest).toBe(fetchView);
    },
  );
});
