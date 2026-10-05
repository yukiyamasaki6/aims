import { describe, expect, it } from "vitest";
import {
  type AppliedOperation,
  applyOperation,
  applyOperations,
  type RoundState,
  roundStateFromCreated,
} from "./round-op-apply";
import { conflicts } from "./round-op-conflicts";
import {
  distanceCreated,
  distanceDisabled,
  distanceUpdated,
  roundCreated,
  roundDisabled,
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "./round-op-test-helpers";
import type { ScoringTargetFace } from "./scorecard-scoring";
import type { SyncOperation } from "./sync-events";

const ring = (scoreStr: string, scoreInt: number, zIndex: number) => ({
  score_str: scoreStr,
  score_int: scoreInt,
  z_index: zIndex,
  color: "#000000",
});

const faces: ScoringTargetFace[] = [
  {
    id: "face-1",
    target_face_spots: [
      {
        target_face_rings: [
          ring("10", 10, 3),
          ring("9", 9, 2),
          ring("5", 5, 1),
        ],
      },
    ],
  },
  {
    id: "face-2",
    target_face_spots: [
      { target_face_rings: [ring("9", 9, 2), ring("5", 5, 1)] },
    ],
  },
];

const base: RoundState = {
  roundConfig: {
    name: "元",
    roundDate: "2026-09-01",
    format: "outdoor",
    bowType: "recurve",
  },
  distances: [
    {
      id: "d-1",
      position_key: "a",
      distance: 70,
      total_ends: 6,
      arrows_per_end: 6,
      target_face_id: "face-1",
      is_marked: true,
    },
  ],
  shots: [],
  roundDisabled: false,
};

const pending = (operation: SyncOperation): AppliedOperation => ({
  operation,
  confirmedFields: undefined,
});
const confirmed = (
  operation: SyncOperation,
  confirmedFields: string[] | null,
): AppliedOperation => ({ operation, confirmedFields });

const apply = (state: RoundState, operation: SyncOperation) =>
  applyOperation(state, pending(operation), faces);

const round = (changes: Record<string, string>) =>
  roundUpdated({
    changes,
  } as never);

describe("applyOperation", () => {
  describe("round.updated", () => {
    it("未確定の差分は、含まれる項目だけを置き換える", () => {
      const state = apply(base, round({ name: "更新後" }));
      expect(state.roundConfig).toEqual({
        ...base.roundConfig,
        name: "更新後",
      });
    });

    it("未確定でも、Unmarkedの距離があるときはフィールド以外へ変えない", () => {
      const withUnmarked: RoundState = {
        ...base,
        roundConfig: { ...base.roundConfig, format: "field" },
        distances: [{ ...base.distances[0], is_marked: false, distance: null }],
      };
      const blocked = apply(withUnmarked, round({ format: "indoor" }));
      expect(blocked.roundConfig.format).toBe("field");
      const ok = apply(
        base,
        round({ format: "indoor", roundDate: "2026-10-01" }),
      );
      expect(ok.roundConfig).toMatchObject({
        format: "indoor",
        roundDate: "2026-10-01",
      });
    });

    it("確定済みは、効いた項目だけを判定せずに反映する", () => {
      const op = round({
        name: "N",
        roundDate: "2026-10-01",
        bowType: "compound",
      });
      const state = applyOperation(
        base,
        confirmed(op, ["name", "bow_type"]),
        faces,
      );
      expect(state.roundConfig).toEqual({
        ...base.roundConfig,
        name: "N",
        bowType: "compound",
      });
      const all = applyOperation(base, confirmed(op, null), faces);
      expect(all.roundConfig.roundDate).toBe("2026-10-01");
      const none = applyOperation(base, confirmed(op, []), faces);
      expect(none.roundConfig).toEqual(base.roundConfig);
    });

    it("確定済みのformatは、Unmarkedの距離があっても効いたなら反映する", () => {
      const withUnmarked: RoundState = {
        ...base,
        distances: [{ ...base.distances[0], is_marked: false }],
      };
      const state = applyOperation(
        withUnmarked,
        confirmed(round({ format: "field" }), ["format"]),
        faces,
      );
      expect(state.roundConfig.format).toBe("field");
    });
  });

  it("距離の作成は末尾へ追加し、同じ距離を重ねて追加しない", () => {
    const op = distanceCreated({ id: "d-2", positionKey: "b" });
    const once = apply(base, op);
    expect(once.distances.map((d) => d.id)).toEqual(["d-1", "d-2"]);
    expect(apply(once, op)).toBe(once);
  });

  it("未確定のUnmarkedの距離は、フィールド以外のラウンドには作らない", () => {
    const op = distanceCreated({ id: "d-2", isMarked: false, distance: null });
    expect(apply(base, op)).toBe(base);
    const field: RoundState = {
      ...base,
      roundConfig: { ...base.roundConfig, format: "field" },
    };
    expect(apply(field, op).distances).toHaveLength(2);
    expect(
      applyOperation(base, confirmed(op, null), faces).distances,
    ).toHaveLength(2);
  });

  describe("distance.updated", () => {
    const update = (changes: Record<string, unknown>) =>
      distanceUpdated({ changes } as never);
    const cfg = { totalEnds: 3, arrowsPerEnd: 3, targetFaceId: "face-1" };

    it("存在しない距離への更新は、状態を変えない", () => {
      expect(apply(base, distanceUpdated({ distanceId: "none" }))).toEqual(
        base,
      );
    });

    it("差分の項目だけを置き換える", () => {
      const state = apply(base, update({ distance: 50, config: cfg }));
      expect(state.distances[0]).toMatchObject({
        distance: 50,
        total_ends: 3,
        arrows_per_end: 3,
        target_face_id: "face-1",
        is_marked: true,
      });
    });

    it("Markedへ変えるとき距離(m)が無ければ、Markedにしない", () => {
      const field: RoundState = {
        ...base,
        roundConfig: { ...base.roundConfig, format: "field" },
        distances: [{ ...base.distances[0], is_marked: false, distance: null }],
      };
      expect(
        apply(field, update({ isMarked: true })).distances[0].is_marked,
      ).toBe(false);
      // 同じ操作では、Marked/Unmarkedを先に判定するため、距離(m)を同時に指定してもMarkedにならない。
      const both = apply(field, update({ isMarked: true, distance: 30 }));
      expect(both.distances[0]).toMatchObject({
        is_marked: false,
        distance: 30,
      });
    });

    it("Unmarkedへ変えるのは、フィールドのときだけ", () => {
      expect(
        apply(base, update({ isMarked: false })).distances[0].is_marked,
      ).toBe(true);
      const field: RoundState = {
        ...base,
        roundConfig: { ...base.roundConfig, format: "field" },
      };
      expect(
        apply(field, update({ isMarked: false })).distances[0].is_marked,
      ).toBe(false);
    });

    it("Markedのまま距離(m)を空にしない", () => {
      expect(
        apply(base, update({ distance: null })).distances[0].distance,
      ).toBe(70);
    });

    it("見える矢が新しい構成で無効になる構成は、反映しない", () => {
      const withShot = apply(base, shotRecorded({ endNumber: 5 }));
      const blocked = apply(withShot, update({ config: cfg }));
      expect(blocked.distances[0].total_ends).toBe(6);
      const nineShot = apply(
        base,
        shotRecorded({ scoreStr: "9", scoreInt: 9 }),
      );
      const fits = apply(
        nineShot,
        update({ config: { ...cfg, totalEnds: 6, targetFaceId: "face-2" } }),
      );
      expect(fits.distances[0].target_face_id).toBe("face-2");
      const tenShot = apply(base, shotRecorded());
      const rejected = apply(
        tenShot,
        update({ config: { ...cfg, totalEnds: 6, targetFaceId: "face-2" } }),
      );
      expect(rejected.distances[0].target_face_id).toBe("face-1");
    });

    it("確定済みの構成は、無効になる矢を取り除いて反映する", () => {
      const withShots = apply(
        apply(base, shotRecorded({ endNumber: 5 })),
        shotRecorded(),
      );
      const state = applyOperation(
        withShots,
        confirmed(update({ config: cfg }), ["config"]),
        faces,
      );
      expect(state.distances[0].total_ends).toBe(3);
      expect(state.shots.map((s) => s.end_number)).toEqual([1]);
    });

    it("確定済みは、効いた項目だけを反映する", () => {
      const state = applyOperation(
        base,
        confirmed(update({ distance: 50, isMarked: false, config: cfg }), [
          "distance",
        ]),
        faces,
      );
      expect(state.distances[0]).toMatchObject({
        distance: 50,
        is_marked: true,
        total_ends: 6,
      });
      const marked = applyOperation(
        base,
        confirmed(update({ isMarked: true }), ["is_marked"]),
        faces,
      );
      expect(marked.distances[0].is_marked).toBe(true);
    });
  });

  it("距離の削除は、距離とその記録を除く", () => {
    const withShot = apply(base, shotRecorded());
    const state = apply(withShot, distanceDisabled());
    expect(state.distances).toEqual([]);
    expect(state.shots).toEqual([]);
  });

  describe("shot", () => {
    it("矢の記録は、同じマスを置き換え、取り消しは除く", () => {
      const first = apply(base, shotRecorded({ scoreStr: "9", scoreInt: 9 }));
      const second = apply(first, shotRecorded());
      expect(second.shots).toEqual([
        expect.objectContaining({ score_str: "10", score_int: 10 }),
      ]);
      expect(apply(second, shotCleared()).shots).toEqual([]);
    });

    it("未確定の矢は、現在の構成で無効なら先の矢も置き換えない", () => {
      const first = apply(base, shotRecorded({ scoreStr: "9", scoreInt: 9 }));
      const outOfRange = apply(first, shotRecorded({ endNumber: 7 }));
      expect(outOfRange).toBe(first);
      const badScore = apply(
        first,
        shotRecorded({ scoreStr: "7", scoreInt: 7 }),
      );
      expect(badScore).toBe(first);
    });

    it("確定済みの矢は、判定せずに反映する", () => {
      const state = applyOperation(
        base,
        confirmed(shotRecorded({ endNumber: 7 }), null),
        faces,
      );
      expect(state.shots).toHaveLength(1);
    });

    it("存在しない距離への記録と取り消しは、状態を変えない", () => {
      expect(apply(base, shotRecorded({ distanceId: "none" }))).toBe(base);
      expect(apply(base, shotCleared({ distanceId: "none" }))).toBe(base);
    });
  });

  it("ラウンドの削除以降の操作は、反映しない", () => {
    const disabled = apply(base, roundDisabled());
    expect(disabled.roundDisabled).toBe(true);
    expect(apply(disabled, roundUpdated())).toBe(disabled);
  });
});

describe("round.created", () => {
  it("作成の操作から、ラウンドの設定と距離を持つ矢の無い状態を作る", () => {
    const operation = roundCreated();
    if (operation.type !== "round.created") throw new Error("type");

    expect(roundStateFromCreated(operation)).toEqual({
      roundConfig: {
        name: "",
        roundDate: "2026-09-29",
        format: "indoor",
        bowType: "compound",
      },
      distances: [
        {
          id: "d-1",
          position_key: "a",
          distance: 18,
          total_ends: 10,
          arrows_per_end: 3,
          target_face_id: "face-1",
          is_marked: true,
        },
      ],
      shots: [],
      roundDisabled: false,
    });
  });

  it("基準が作成の操作から作られているため、重ねても状態を変えない", () => {
    const operation = roundCreated();
    if (operation.type !== "round.created") throw new Error("type");
    const state = roundStateFromCreated(operation);

    expect(apply(state, operation)).toBe(state);
  });
});

describe("applyOperations", () => {
  const ops = [
    roundUpdated(),
    distanceCreated({ id: "d-2", positionKey: "b" }),
    shotRecorded(),
    shotRecorded({ arrowNumber: 2 }),
    shotCleared({ distanceId: "d-2" }),
    distanceUpdated(),
  ].map(pending);

  it("同じ操作の列を重ねて適用しても、結果は変わらない(冪等)", () => {
    const once = applyOperations(base, ops, faces);
    expect(applyOperations(once, ops, faces)).toEqual(once);
  });

  it("衝突しない操作の入れ替えは、結果を変えない", () => {
    const a = shotRecorded({ arrowNumber: 1 });
    const b = shotRecorded({ arrowNumber: 2, eventId: "e-2" });
    expect(conflicts(a, b)).toBe(false);
    const ab = applyOperations(base, [pending(a), pending(b)], faces);
    const ba = applyOperations(base, [pending(b), pending(a)], faces);
    expect(
      [...ab.shots].sort((x, y) => x.arrow_number - y.arrow_number),
    ).toEqual([...ba.shots].sort((x, y) => x.arrow_number - y.arrow_number));
  });

  it("操作が無ければ基準をそのまま返す", () => {
    expect(applyOperations(base, [], faces)).toBe(base);
  });
});
