import { describe, expect, it } from "vitest";
import {
  deletedRoundIdsOf,
  localRoundsList,
  roundListItemOf,
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

// 実際の屋外ラウンドの形(各距離12エンド×3射)は、合計の算術を見るには冗長になる。値そのものが検証の対象のため、少数の矢で確かめる。
describe("roundListItemOf", () => {
  const summary = (
    distances: ServerRoundSummary["distances"],
  ): ServerRoundSummary => ({
    id: "round-2",
    name: "午後練習",
    round_date: "2026-09-16",
    distances,
  });
  const shot = (scoreInt: number, disabled = false) => ({
    score_int: scoreInt,
    disabled_at: disabled ? "2026-09-16T00:00:00Z" : null,
  });
  const distance = (
    shots: ServerRoundSummary["distances"][number]["shots"],
    disabled = false,
  ) => ({
    disabled_at: disabled ? "2026-09-16T00:00:00Z" : null,
    shots,
  });

  it("削除されていない距離の、削除されていない矢の点の和を合計点にし、id、name、実施日(round_date)をそのまま返す", () => {
    // Given
    const input = summary([
      distance([shot(10), shot(9), shot(8)]),
      distance([shot(7), shot(6)]),
    ]);

    // When
    const result = roundListItemOf(input);

    // Then
    expect(result).toEqual({
      id: "round-2",
      name: "午後練習",
      roundDate: "2026-09-16",
      total: 40,
    });
  });

  it("削除された距離の矢と、削除された矢を合計に含めない", () => {
    // Given
    const input = summary([
      distance([shot(10), shot(9, true)]),
      distance([shot(8)], true),
      distance([shot(7)]),
    ]);

    // When
    const result = roundListItemOf(input);

    // Then
    expect(result.total).toBe(17);
  });

  it("距離が0件のときも、矢が0件のときも、合計点は0", () => {
    // Given
    const withoutDistances = summary([]);
    const withoutShots = summary([distance([])]);

    // When
    const noDistances = roundListItemOf(withoutDistances);
    const noShots = roundListItemOf(withoutShots);

    // Then
    expect(noDistances.total).toBe(0);
    expect(noShots.total).toBe(0);
  });
});
