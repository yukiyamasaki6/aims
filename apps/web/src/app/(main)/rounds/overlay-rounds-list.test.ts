import { describe, expect, it } from "vitest";
import type { FetchView } from "@/features/fetch-result/fetch-result";
import type { RoundListItem } from "./fetch-rounds-list";
import type { LoadedRoundsList, LocalRoundsList } from "./load-rounds-list";
import { overlayRoundsList, roundsListView } from "./overlay-rounds-list";

function item(id: string, roundDate = "2026-09-15", total = 0): RoundListItem {
  return { id, name: id, roundDate, total };
}

const ids = (rounds: RoundListItem[] | null) => rounds?.map((r) => r.id);

describe("overlayRoundsList", () => {
  it("削除済みのラウンドを除き、同じ実施日では取得の順序を保つ", () => {
    const result = overlayRoundsList(
      [item("c"), item("a"), item("b")],
      [],
      new Set(["a"]),
    );

    expect(ids(result.others)).toEqual(["c", "b"]);
  });

  it("入力中のラウンドと、それ以外を、実施日の新しい順に分ける", () => {
    const result = overlayRoundsList(
      [
        item("old", "2026-09-01"),
        item("new", "2026-09-20"),
        item("p-old", "2026-09-02"),
        item("p-new", "2026-09-19"),
      ],
      [item("p-old", "2026-09-02"), item("p-new", "2026-09-19")],
      new Set(),
    );

    expect(ids(result.inProgress)).toEqual(["p-new", "p-old"]);
    expect(ids(result.others)).toEqual(["new", "old"]);
  });

  it("入力中のラウンドは、取得の中にあっても、それ以外の並びに重複させない(値は端末から導いた入力中のものを使う)", () => {
    const result = overlayRoundsList(
      [item("a", "2026-09-15", 10)],
      [item("a", "2026-09-15", 30)],
      new Set(),
    );

    expect(result.inProgress).toEqual([item("a", "2026-09-15", 30)]);
    expect(result.others).toEqual([]);
  });

  it("取得に無い入力中のラウンドも、入力中の領域に出し、同じ実施日では取得にあるものの後に置く", () => {
    const result = overlayRoundsList(
      [item("b"), item("a")],
      [item("local"), item("a")],
      new Set(),
    );

    expect(ids(result.inProgress)).toEqual(["a", "local"]);
  });

  it("取得で入力中でないラウンド(端末で完了にした未送信のラウンドなど)は、それ以外の並びに取得の値で出す", () => {
    const result = overlayRoundsList(
      [item("done", "2026-09-15", 50)],
      [],
      new Set(),
    );

    expect(result.others).toEqual([item("done", "2026-09-15", 50)]);
  });

  it("削除済みの入力中のラウンドは、どちらにも出さない", () => {
    const result = overlayRoundsList([item("a")], [item("a")], new Set(["a"]));

    expect(result).toEqual({ inProgress: [], others: [] });
  });
});

describe("roundsListView", () => {
  const loaded = (
    overrides: Partial<LoadedRoundsList> = {},
  ): FetchView<LoadedRoundsList> => ({
    status: "ok",
    data: {
      items: [],
      inProgress: [],
      deleted: new Set(),
      confirmedDeletions: [],
      startedAt: 1,
      ...overrides,
    },
  });
  const local: LocalRoundsList = {
    inProgress: [item("p1", "2026-09-10"), item("p2", "2026-09-12")],
    deleted: new Set(),
  };

  it("取得が成功したら、入力中の領域とそれ以外の並びを返し、取得の状態は返さない", () => {
    const view = roundsListView(
      loaded({ items: [item("a"), item("p1")], inProgress: [item("p1")] }),
      null,
      false,
      new Set(),
    );

    expect(ids(view.inProgress)).toEqual(["p1"]);
    expect(ids(view.others)).toEqual(["a"]);
    expect(view.rest).toBeNull();
    expect(view.empty).toBe(false);
  });

  it("取得が成功し、両方が0件なら、空とする", () => {
    expect(roundsListView(loaded(), null, false, new Set()).empty).toBe(true);
  });

  it("取得が成功し、入力中だけがあれば、空としない", () => {
    const view = roundsListView(
      loaded({ items: [item("p1")], inProgress: [item("p1")] }),
      null,
      false,
      new Set(),
    );

    expect(view.empty).toBe(false);
    expect(view.others).toEqual([]);
  });

  it("この画面で削除したラウンドは、取得が成功していても除く", () => {
    const view = roundsListView(
      loaded({ items: [item("a"), item("p1")], inProgress: [item("p1")] }),
      null,
      false,
      new Set(["p1", "a"]),
    );

    expect(view.inProgress).toEqual([]);
    expect(view.others).toEqual([]);
    expect(view.empty).toBe(true);
  });

  it.each([
    ["offline", { status: "offline" }],
    ["error", { status: "error", message: "読み込めませんでした。" }],
  ] as const)(
    "取得が%sなら、待たずに端末の入力中のラウンドを実施日の新しい順に返し、取得の状態を返す",
    (_name, view) => {
      const result = roundsListView(view, local, false, new Set());

      expect(ids(result.inProgress)).toEqual(["p2", "p1"]);
      expect(result.others).toBeNull();
      expect(result.rest).toBe(view);
      expect(result.empty).toBe(false);
    },
  );

  it("取得中は、FALLBACK_WAIT_MSが過ぎるまで入力中の領域を出さない", () => {
    const view = { status: "loading" } as const;

    const before = roundsListView(view, local, false, new Set());
    const after = roundsListView(view, local, true, new Set());

    expect(before.inProgress).toEqual([]);
    expect(before.rest).toBe(view);
    expect(ids(after.inProgress)).toEqual(["p2", "p1"]);
    expect(after.rest).toBe(view);
  });

  it("端末の入力中のラウンドをまだ読んでいなければ、入力中の領域を出さない", () => {
    const result = roundsListView({ status: "offline" }, null, true, new Set());

    expect(result.inProgress).toEqual([]);
  });

  it("端末で削除済み、またはこの画面で削除したラウンドは、端末から出す入力中の領域から除く", () => {
    const result = roundsListView(
      { status: "offline" },
      { ...local, deleted: new Set(["p1"]) },
      false,
      new Set(["p2"]),
    );

    expect(result.inProgress).toEqual([]);
  });
});
