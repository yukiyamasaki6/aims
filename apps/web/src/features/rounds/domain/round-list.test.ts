import { describe, expect, it } from "vitest";
import {
  deletionsOf,
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
import type { ScoringTargetFace } from "./scorecard-scoring";

const faces: ScoringTargetFace[] = [
  {
    id: "face-1",
    target_face_spots: [
      {
        target_face_rings: [
          { score_str: "10", score_int: 10, z_index: 2, color: "#000000" },
          { score_str: "9", score_int: 9, z_index: 1, color: "#000000" },
        ],
      },
    ],
  },
];

const pending = (operation: ReturnType<typeof roundDisabled>) => ({
  operation,
  confirmedFields: undefined,
});

describe("deletionsOf", () => {
  it("削除済みのラウンドを削除の印にし、そのうち削除が確定したラウンドだけを確定済みにする", () => {
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
    const { deleted, confirmed } = deletionsOf(snapshots);

    // Then
    expect([...deleted]).toEqual(["r-unsent", "r-confirmed"]);
    expect(confirmed).toEqual(["r-confirmed"]);
  });
});

describe("localRoundsList", () => {
  it("入力中のラウンドだけを、名前と日付と合計点で返す。削除済みは削除の印に分ける", () => {
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
    const { inProgress, deleted } = localRoundsList(snapshots, faces);

    // Then
    expect(inProgress).toEqual([
      { id: "r-active", name: "午前", roundDate: "2026-09-15", total: 0 },
    ]);
    expect([...deleted]).toEqual(["r-deleted"]);
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
    const { inProgress } = localRoundsList(snapshots, faces);

    // Then
    expect(inProgress).toEqual([
      { id: "round-1", name: "新規", roundDate: "2026-09-29", total: 19 },
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
    roundDate: "2026-09-16",
    distances,
  });
  const shot = (scoreInt: number, disabled = false) => ({
    score_int: scoreInt,
    disabled,
  });

  it("削除されていない距離の、削除されていない矢の点の和を合計点にし、id、name、roundDateをそのまま返す", () => {
    // Given
    const input = summary([
      { disabled: false, shots: [shot(10), shot(9), shot(8)] },
      { disabled: false, shots: [shot(7), shot(6)] },
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
      { disabled: false, shots: [shot(10), shot(9, true)] },
      { disabled: true, shots: [shot(8)] },
      { disabled: false, shots: [shot(7)] },
    ]);

    // When
    const result = roundListItemOf(input);

    // Then
    expect(result.total).toBe(17);
  });

  it("距離が0件のときも、矢が0件のときも、合計点は0", () => {
    // Given
    const withoutDistances = summary([]);
    const withoutShots = summary([{ disabled: false, shots: [] }]);

    // When
    const noDistances = roundListItemOf(withoutDistances);
    const noShots = roundListItemOf(withoutShots);

    // Then
    expect(noDistances.total).toBe(0);
    expect(noShots.total).toBe(0);
  });
});
