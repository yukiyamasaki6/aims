import { describe, expect, it } from "vitest";
import {
  appendRoundsList,
  type DistanceListItem,
  deletedRoundIdsOf,
  historyPageSizeOf,
  type LoadedRoundsList,
  localRoundsList,
  type RoundListItem,
  roundIdOfItem,
  roundListItemOf,
  roundsPageOf,
  type ServerRoundSummary,
} from "./round-list";
import {
  distanceDisabled,
  roundBase,
  roundCreated,
  roundDisabled,
  shotCleared,
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
      {
        id: "r-active",
        name: "午前",
        roundDate: "2026-09-15",
        format: "outdoor",
        bowType: "recurve",
        total: 0,
        distances: [],
      },
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
      {
        id: "round-1",
        name: "新規",
        roundDate: "2026-09-29",
        format: "indoor",
        bowType: "compound",
        total: 19,
        distances: [{ distance: 18, isMarked: true, total: 19 }],
      },
    ]);
  });
});

describe("localRoundsList: 距離ごとの小計", () => {
  const distanceOf = (
    id: string,
    positionKey: string,
    distance: number,
    isMarked = true,
  ) => ({
    eventId: `e-created-${id}`,
    id,
    positionKey,
    distance,
    isMarked,
    totalEnds: 10,
    arrowsPerEnd: 3,
    targetFaceId: "face-1",
  });
  const shot = (id: string, distanceId: string, score: number) =>
    pending(
      shotRecorded({
        eventId: `e-${id}`,
        shotId: id,
        distanceId,
        scoreStr: String(score),
        scoreInt: score,
      }),
    );
  const snapshotOf = (operations: ReturnType<typeof pending>[]) =>
    new Map([["round-1", { base: undefined, operations }]]);

  it("距離を射つ順に並べ、距離ごとの小計と、その和の合計点を返す。矢のない距離の小計は0にする", () => {
    // Given
    // 作成時の並びでなく、射つ順(位置のキー)で並ぶことを見分けるため、位置のキーを作成の順と逆にする。
    const snapshots = snapshotOf([
      pending(
        roundCreated({
          distances: [
            distanceOf("d-late", "b", 50),
            distanceOf("d-first", "a", 70, false),
            distanceOf("d-empty", "c", 30),
          ],
        }),
      ),
      shot("s-1", "d-late", 9),
      shot("s-2", "d-first", 10),
      shot("s-3", "d-first", 8),
    ]);

    // When
    const { inProgress } = localRoundsList(snapshots);

    // Then
    expect(inProgress[0]?.distances).toEqual([
      { distance: 70, isMarked: false, total: 18 },
      { distance: 50, isMarked: true, total: 9 },
      { distance: 30, isMarked: true, total: 0 },
    ]);
    expect(inProgress[0]?.total).toBe(27);
  });

  it("無効にした距離と、消した矢を、距離にも小計にも合計にも含めない", () => {
    // Given
    const snapshots = snapshotOf([
      pending(
        roundCreated({
          distances: [distanceOf("d-1", "a", 70), distanceOf("d-2", "b", 50)],
        }),
      ),
      shot("s-1", "d-1", 10),
      shot("s-2", "d-1", 9),
      shot("s-3", "d-2", 8),
      pending(
        shotCleared({ eventId: "e-clear", shotId: "s-2", distanceId: "d-1" }),
      ),
      pending(distanceDisabled("d-2")),
    ]);

    // When
    const { inProgress } = localRoundsList(snapshots);

    // Then
    expect(inProgress[0]?.distances).toEqual([
      { distance: 70, isMarked: true, total: 10 },
    ]);
    expect(inProgress[0]?.total).toBe(10);
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
      {
        id: "round-1",
        name: "新規",
        roundDate: "2026-09-29",
        format: "indoor",
        bowType: "compound",
        total: 17,
        distances: [{ distance: 18, isMarked: true, total: 17 }],
      },
    ]);
  });
});

describe("roundListItemOf", () => {
  it("サーバーの応答の列を、画面の名前(roundDate、format、bowType、total、距離ごとの小計)へ写す", () => {
    // Given
    const summary: ServerRoundSummary = {
      id: "round-2",
      name: "午後練習",
      round_date: "2026-09-16",
      format: "indoor",
      bow_type: "compound",
      total: 640,
      distances: [
        { distance: 18, is_marked: true, total: 400 },
        { distance: null, is_marked: false, total: 240 },
      ],
    };

    // When
    const item = roundListItemOf(summary);

    // Then
    expect(item).toEqual({
      id: "round-2",
      name: "午後練習",
      roundDate: "2026-09-16",
      format: "indoor",
      bowType: "compound",
      total: 640,
      distances: [
        { distance: 18, isMarked: true, total: 400 },
        { distance: null, isMarked: false, total: 240 },
      ],
    });
  });
});

describe("roundsPageOf", () => {
  const summary = (id: string): ServerRoundSummary => ({
    id,
    name: id,
    round_date: "2026-09-16",
    format: "outdoor",
    bow_type: "recurve",
    total: 500,
    distances: [],
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

describe("roundsPageOf: 距離単位", () => {
  const summary = (id: string, roundId: string, distance: number | null) => ({
    id,
    round_id: roundId,
    name: `${roundId}の名前`,
    round_date: "2026-09-16",
    format: "outdoor",
    bow_type: "recurve",
    distance,
    is_marked: distance !== null,
    total: 300,
  });

  it("サーバーの応答の列を画面の名前へ写し、距離がnullならnullのまま写す", () => {
    // Given
    const page = {
      distances: [summary("d-1", "r-1", 50), summary("d-2", "r-1", null)],
      hasMore: true,
    };

    // When
    const result = roundsPageOf(page);

    // Then
    expect(result.items).toEqual([
      {
        id: "d-1",
        roundId: "r-1",
        name: "r-1の名前",
        roundDate: "2026-09-16",
        format: "outdoor",
        bowType: "recurve",
        distance: 50,
        isMarked: true,
        total: 300,
      },
      {
        id: "d-2",
        roundId: "r-1",
        name: "r-1の名前",
        roundDate: "2026-09-16",
        format: "outdoor",
        bowType: "recurve",
        distance: null,
        isMarked: false,
        total: 300,
      },
    ]);
  });

  it("サーバーの順のまま項目にし、続きの起点を、返した最後の距離のID(ラウンドのIDでない)にする", () => {
    // Given
    const page = {
      distances: [summary("d-9", "r-2", 30), summary("d-3", "r-1", 50)],
      hasMore: true,
    };

    // When
    const result = roundsPageOf(page);

    // Then
    expect(result.items.map((item) => item.id)).toEqual(["d-9", "d-3"]);
    expect(result.hasMore).toBe(true);
    expect(result.after).toBe("d-3");
  });

  it("空のページは、起点をnullにする", () => {
    // Given
    const page = { distances: [], hasMore: false };

    // When
    const result = roundsPageOf(page);

    // Then
    expect(result).toEqual({ items: [], hasMore: false, after: null });
  });
});

const entry = (id: string): RoundListItem => ({
  id,
  name: id,
  roundDate: "2026-09-16",
  format: "outdoor",
  bowType: "recurve",
  total: 500,
  distances: [{ distance: 70, isMarked: true, total: 500 }],
});
const distanceEntry = (id: string, roundId: string): DistanceListItem => ({
  id,
  roundId,
  name: id,
  roundDate: "2026-09-16",
  format: "outdoor",
  bowType: "recurve",
  distance: 50,
  isMarked: true,
  total: 500,
});

describe("roundIdOfItem", () => {
  it("距離単位の項目は属するラウンドのID、ラウンド単位の項目は自身のIDを返す", () => {
    // Given
    const roundItem = entry("r-1");
    const distanceItem = distanceEntry("d-1", "r-2");

    // When
    const ids = [roundIdOfItem(roundItem), roundIdOfItem(distanceItem)];

    // Then
    expect(ids).toEqual(["r-1", "r-2"]);
  });
});

describe("appendRoundsList", () => {
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

  it("距離単位では、距離のIDが重なる項目は先に出た方を残し、同じラウンドの別の距離は残す", () => {
    // Given
    const distance = distanceEntry;
    const current: LoadedRoundsList = {
      ...loaded([]),
      items: [distance("d-1", "r-1"), distance("d-2", "r-1")],
    };
    const next: LoadedRoundsList = {
      ...loaded([]),
      items: [distance("d-2", "r-1"), distance("d-3", "r-1")],
    };

    // When
    const result = appendRoundsList(current, next);

    // Then
    expect(result.items.map((item) => item.id)).toEqual(["d-1", "d-2", "d-3"]);
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
