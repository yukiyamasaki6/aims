import { describe, expect, it } from "vitest";
import {
  roundBase,
  roundCreated,
  roundDisabled,
  shotRecorded,
} from "../round-op-test-helpers";
import { deletionsOf, localRoundsList } from "./round-list";
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
