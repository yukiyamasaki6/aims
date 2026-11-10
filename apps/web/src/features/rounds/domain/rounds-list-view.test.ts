import { describe, expect, it } from "vitest";
import type { FetchView } from "./fetch-status";
import type {
  LoadedRoundsList,
  LocalRoundsList,
  RoundListItem,
} from "./round-list";
import { overlayRoundsList, roundsListView } from "./rounds-list-view";

function item(id: string, roundDate = "2026-09-15", total = 0): RoundListItem {
  return { id, name: id, roundDate, total };
}

const ids = (rounds: RoundListItem[] | null) => rounds?.map((r) => r.id);

describe("overlayRoundsList", () => {
  it("削除済みのラウンドを除き、それ以外は取得の順のまま並べる", () => {
    // Given

    // When
    const result = overlayRoundsList(
      [item("c"), item("a"), item("b")],
      [],
      new Set(["a"]),
    );

    // Then
    expect(ids(result.others)).toEqual(["c", "b"]);
  });

  it("入力中のラウンドは実施日の新しい順に並べ、それ以外は取得の順のまま、分ける", () => {
    // Given

    // When
    const result = overlayRoundsList(
      [
        item("new", "2026-09-20"),
        item("old", "2026-09-01"),
        item("p-old", "2026-09-02"),
        item("p-new", "2026-09-19"),
      ],
      [item("p-old", "2026-09-02"), item("p-new", "2026-09-19")],
      new Set(),
    );

    // Then
    expect(ids(result.inProgress)).toEqual(["p-new", "p-old"]);
    expect(ids(result.others)).toEqual(["new", "old"]);
  });

  it("入力中のラウンドは、取得の中にあっても、それ以外の並びに重複させない(値は端末から導いた入力中のものを使う)", () => {
    // Given

    // When
    const result = overlayRoundsList(
      [item("a", "2026-09-15", 10)],
      [item("a", "2026-09-15", 30)],
      new Set(),
    );

    // Then
    expect(result.inProgress).toEqual([item("a", "2026-09-15", 30)]);
    expect(result.others).toEqual([]);
  });

  it("取得に無い入力中のラウンドも、入力中の領域に出す", () => {
    // Given

    // When
    const result = overlayRoundsList(
      [item("b"), item("a")],
      [item("local"), item("a")],
      new Set(),
    );

    // Then
    expect(ids(result.inProgress)).toEqual(["local", "a"]);
  });

  it("取得で入力中でないラウンド(端末で完了にした未送信のラウンドなど)は、それ以外の並びに取得の値で出す", () => {
    // Given

    // When
    const result = overlayRoundsList(
      [item("done", "2026-09-15", 50)],
      [],
      new Set(),
    );

    // Then
    expect(result.others).toEqual([item("done", "2026-09-15", 50)]);
  });

  it("削除済みの入力中のラウンドは、どちらにも出さない", () => {
    // Given

    // When
    const result = overlayRoundsList([item("a")], [item("a")], new Set(["a"]));

    // Then
    expect(result).toEqual({ inProgress: [], others: [] });
  });
});

describe("roundsListView", () => {
  const loaded = (
    overrides: Partial<LoadedRoundsList> = {},
  ): FetchView<LoadedRoundsList> => ({
    status: "ok",
    data: { items: [], deleted: new Set(), ...overrides },
  });
  const local: LocalRoundsList = {
    inProgress: [item("p1", "2026-09-10"), item("p2", "2026-09-12")],
  };
  const empty: LocalRoundsList = { inProgress: [] };

  it("取得が成功したら、入力中の領域は常に端末の値で出し、それ以外は取得から入力中の領域を除いて並べ、取得の状態は返さない", () => {
    // Given

    // When
    const view = roundsListView(
      loaded({ items: [item("a"), item("p1")] }),
      local,
      new Set(),
    );

    // Then
    expect(ids(view.inProgress)).toEqual(["p2", "p1"]);
    expect(ids(view.others)).toEqual(["a"]);
    expect(view.rest).toBeNull();
    expect(view.empty).toBe(false);
  });

  it("取得が成功しても、端末の入力中をまだ読んでいなければ、取得中として返す", () => {
    // Given

    // When
    const view = roundsListView(
      loaded({ items: [item("a")] }),
      null,
      new Set(),
    );

    // Then
    expect(view).toEqual({
      inProgress: [],
      others: null,
      rest: { status: "loading" },
      empty: false,
    });
  });

  it("取得が成功し、両方が0件なら、空とする", () => {
    // Given

    // When
    const view = roundsListView(loaded(), empty, new Set());

    // Then
    expect(view.empty).toBe(true);
  });

  it("取得が成功し、入力中だけがあれば、空としない", () => {
    // Given

    // When
    const view = roundsListView(
      loaded({ items: [item("p1")] }),
      { inProgress: [item("p1")] },
      new Set(),
    );

    // Then
    expect(view.empty).toBe(false);
    expect(view.others).toEqual([]);
  });

  it("この画面で削除したラウンドと、端末の列で削除済みのラウンドは、取得が成功していても除く", () => {
    // Given

    // When
    const view = roundsListView(
      loaded({
        items: [item("a"), item("b"), item("p1")],
        deleted: new Set(["b"]),
      }),
      { inProgress: [item("p1")] },
      new Set(["p1", "a"]),
    );

    // Then
    expect(view.inProgress).toEqual([]);
    expect(view.others).toEqual([]);
    expect(view.empty).toBe(true);
  });

  it.each([
    ["loading", { status: "loading" }],
    ["offline", { status: "offline" }],
    ["error", { status: "error", reason: "failed" }],
  ] as const)(
    "取得が%sでも、端末の入力中のラウンドを実施日の新しい順に返し、取得の状態を返す",
    (_name, view) => {
      // Given

      // When
      const result = roundsListView(view, local, new Set());

      // Then
      expect(ids(result.inProgress)).toEqual(["p2", "p1"]);
      expect(result.others).toBeNull();
      expect(result.rest).toBe(view);
      expect(result.empty).toBe(false);
    },
  );

  it("端末の入力中のラウンドをまだ読んでいなければ、入力中の領域を出さない", () => {
    // Given

    // When
    const result = roundsListView({ status: "offline" }, null, new Set());

    // Then
    expect(result.inProgress).toEqual([]);
  });

  it("この画面で削除したラウンドは、端末から出す入力中の領域から除く", () => {
    // Given

    // When
    const result = roundsListView(
      { status: "offline" },
      local,
      new Set(["p1", "p2"]),
    );

    // Then
    expect(result.inProgress).toEqual([]);
  });
});
