import { describe, expect, it } from "vitest";
import {
  appendRoundsList,
  deletedRoundIdsOf,
  historyPageSizeOf,
  type LoadedRoundsList,
  localRoundsList,
  type RoundListItem,
  roundListItemOf,
  roundsPageOf,
  type ServerRoundSummary,
} from "./round-list";
import {
  roundBase,
  roundCreated,
  roundDisabled,
  shotRecorded,
} from "./round-op-test-helpers";

const pending = (operation: ReturnType<typeof roundDisabled>) => ({
  operation,
  confirmedFields: undefined,
});

describe("deletedRoundIdsOf", () => {
  it("削除の操作を持つラウンドのIDを、確定の有無によらず返す", () => {
    // Given
    const snapshots = new Map([
      [
        "r-unsent",
        { base: undefined, operations: [pending(roundDisabled("e1"))] },
      ],
      [
        "r-confirmed",
        {
          base: undefined,
          operations: [
            { operation: roundDisabled("e2"), confirmedFields: null },
          ],
        },
      ],
      ["r-alive", { base: undefined, operations: [pending(roundCreated())] }],
    ]);

    // When
    const deleted = deletedRoundIdsOf(snapshots);

    // Then
    expect([...deleted]).toEqual(["r-unsent", "r-confirmed"]);
  });
});

describe("localRoundsList", () => {
  it("入力中のラウンドだけを、名前と日付と合計点で返し、完了済み・削除済み・基準のないラウンドを含めない", () => {
    // Given
    const snapshots = new Map([
      [
        "r-active",
        {
          base: { startedAt: 1, base: roundBase({ name: "午前" }) },
          operations: [],
        },
      ],
      [
        "r-done",
        {
          base: { startedAt: 1, base: roundBase({ status: "completed" }) },
          operations: [],
        },
      ],
      [
        "r-deleted",
        { base: undefined, operations: [pending(roundDisabled())] },
      ],
      ["r-empty", { base: undefined, operations: [] }],
    ]);

    // When
    const { inProgress } = localRoundsList(snapshots);

    // Then
    expect(inProgress).toEqual([
      { id: "r-active", name: "午前", roundDate: "2026-09-15", total: 0 },
    ]);
  });

  it("作成が未確定で記録した矢の点数を、合計に含める", () => {
    // Given
    const snapshots = new Map([
      [
        "round-1",
        {
          base: undefined,
          operations: [
            pending(roundCreated({ name: "新規" })),
            pending(shotRecorded({ scoreStr: "10", scoreInt: 10 })),
            pending(
              shotRecorded({
                eventId: "e-2",
                shotId: "s-2",
                scoreStr: "9",
                scoreInt: 9,
              }),
            ),
          ],
        },
      ],
    ]);

    // When
    const { inProgress } = localRoundsList(snapshots);

    // Then
    expect(inProgress).toEqual([
      { id: "round-1", name: "新規", roundDate: "2026-09-29", total: 19 },
    ]);
  });
});

describe("localRoundsList: 的に無い点数", () => {
  it("未送信の矢の点数が距離の的に無い点数でも、合計に含める(一覧は的を読まない)", () => {
    // Given
    const snapshots = new Map([
      [
        "round-1",
        {
          base: undefined,
          operations: [
            pending(roundCreated({ name: "新規" })),
            pending(shotRecorded({ scoreStr: "7", scoreInt: 7 })),
            pending(
              shotRecorded({
                eventId: "e-2",
                shotId: "s-2",
                scoreStr: "10",
                scoreInt: 10,
              }),
            ),
          ],
        },
      ],
    ]);

    // When
    const { inProgress } = localRoundsList(snapshots);

    // Then
    expect(inProgress).toEqual([
      { id: "round-1", name: "新規", roundDate: "2026-09-29", total: 17 },
    ]);
  });
});

describe("roundListItemOf", () => {
  it("サーバーの応答の列(round_date)と合計点を、画面の名前(roundDate、total)へ写す", () => {
    // Given
    const summary: ServerRoundSummary = {
      id: "round-2",
      name: "午後練習",
      round_date: "2026-09-16",
      total: 640,
    };

    // When
    const item = roundListItemOf(summary);

    // Then
    expect(item).toEqual({
      id: "round-2",
      name: "午後練習",
      roundDate: "2026-09-16",
      total: 640,
    });
  });
});

describe("roundsPageOf", () => {
  const summary = (id: string): ServerRoundSummary => ({
    id,
    name: id,
    round_date: "2026-09-16",
    total: 500,
  });

  it("サーバーの順のまま項目にし、続きの有無と、返した最後のラウンドのIDを起点にする", () => {
    // Given
    const page = { rounds: [summary("b"), summary("a")], hasMore: true };

    // When
    const result = roundsPageOf(page);

    // Then
    expect(result.items.map((item) => item.id)).toEqual(["b", "a"]);
    expect(result.hasMore).toBe(true);
    expect(result.after).toBe("a");
  });

  it("空のページは、起点をnullにする", () => {
    // Given
    const page = { rounds: [], hasMore: false };

    // When
    const result = roundsPageOf(page);

    // Then
    expect(result).toEqual({ items: [], hasMore: false, after: null });
  });
});

describe("appendRoundsList", () => {
  const entry = (id: string): RoundListItem => ({
    id,
    name: id,
    roundDate: "2026-09-16",
    total: 500,
  });
  const loaded = (
    ids: string[],
    overrides: Partial<LoadedRoundsList> = {},
  ): LoadedRoundsList => ({
    items: ids.map(entry),
    hasMore: true,
    after: ids.at(-1) ?? null,
    deleted: new Set(),
    ...overrides,
  });

  it("次のページの項目を、取得済みの項目の後ろに連結する", () => {
    // Given
    const current = loaded(["a", "b"]);
    const next = loaded(["c", "d"]);

    // When
    const result = appendRoundsList(current, next);

    // Then
    expect(result.items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("IDが重なる項目は、先に出た方を残して2回出さない", () => {
    // Given
    const current = loaded(["a", "b"]);
    const next = loaded(["b", "c"]);
    next.items[0] = { ...entry("b"), name: "後のページのb" };

    // When
    const result = appendRoundsList(current, next);

    // Then
    expect(result.items).toEqual([entry("a"), entry("b"), entry("c")]);
  });

  it("続きの有無と起点は新しいページのものにし、削除済みのIDは和にする", () => {
    // Given
    const current = loaded(["a"], { deleted: new Set(["x"]) });
    const next = loaded(["b"], {
      hasMore: false,
      after: "b",
      deleted: new Set(["y"]),
    });

    // When
    const result = appendRoundsList(current, next);

    // Then
    expect(result.hasMore).toBe(false);
    expect(result.after).toBe("b");
    expect([...result.deleted].sort()).toEqual(["x", "y"]);
  });

  it("空のページを連結しても、取得済みの項目は変わらない", () => {
    // Given
    const current = loaded(["a", "b"]);
    const next = loaded([], { hasMore: false, after: null });

    // When
    const result = appendRoundsList(current, next);

    // Then
    expect(result.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.hasMore).toBe(false);
  });
});

describe("historyPageSizeOf", () => {
  it("画面の高さを1件分の高さで割った2画面分(切り上げ)にし、10と50の境界とその前後はその範囲に収める", () => {
    // Given
    // 画面の高さ1000に対し、1件分の高さを変えて、下限(10)・上限(50)の境界とその前後を作る。
    const viewport = 1000;

    // When
    const sizes = {
      belowMin: historyPageSizeOf(viewport, 250),
      atMin: historyPageSizeOf(viewport, 200),
      aboveMin: historyPageSizeOf(viewport, 199),
      middle: historyPageSizeOf(viewport, 80),
      belowMax: historyPageSizeOf(viewport, 41),
      atMax: historyPageSizeOf(viewport, 40),
      aboveMax: historyPageSizeOf(viewport, 39),
    };

    // Then
    expect(sizes).toEqual({
      belowMin: 10,
      atMin: 10,
      aboveMin: 11,
      middle: 25,
      belowMax: 49,
      atMax: 50,
      aboveMax: 50,
    });
  });

  it.each([
    ["0", 0],
    ["負", -10],
    ["NaN", Number.NaN],
  ])("1件分の高さが%sのとき、下限にする", (_name, itemHeight) => {
    // Given

    // When
    const size = historyPageSizeOf(800, itemHeight);

    // Then
    expect(size).toBe(10);
  });
});
