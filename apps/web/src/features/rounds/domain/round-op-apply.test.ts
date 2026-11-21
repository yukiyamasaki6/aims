import { describe, expect, it } from "vitest";
import {
  type AppliedOperation,
  applyOperation,
  applyOperations,
} from "./round-op-apply";
import { conflicts } from "./round-op-conflicts";
import {
  distanceCreated,
  distanceDisabled,
  distanceUpdated,
  roundCreated,
  roundDisabled,
  roundTablesFromServer,
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "./round-op-test-helpers";
import {
  type RoundTables,
  roundTablesFromCreated,
  type ShotRow,
} from "./round-tables";
import {
  compareDistancePosition,
  type ScoringTargetFace,
} from "./scorecard-scoring";
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

const distance1 = {
  id: "d-1",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
};

const base: RoundTables = roundTablesFromServer({
  status: "in_progress",
  roundConfig: {
    name: "元",
    roundDate: "2026-09-01",
    format: "outdoor",
    bowType: "recurve",
  },
  distances: [distance1],
  shots: [],
});

// フィールドのラウンドに、Unmarkedの距離がある基準。
const fieldWithUnmarked: RoundTables = {
  ...base,
  round: { ...base.round, config: { ...base.round.config, format: "field" } },
  distances: [{ ...base.distances[0], is_marked: false, distance: null }],
};
const field: RoundTables = {
  ...fieldWithUnmarked,
  distances: [base.distances[0]],
};

const pending = (operation: SyncOperation): AppliedOperation => ({
  operation,
  confirmedFields: undefined,
});
const confirmed = (
  operation: SyncOperation,
  confirmedFields: string[] | null,
): AppliedOperation => ({ operation, confirmedFields });

const apply = (tables: RoundTables, operation: SyncOperation) =>
  applyOperation(tables, pending(operation), faces);
const applyConfirmed = (
  tables: RoundTables,
  operation: SyncOperation,
  confirmedFields: string[] | null,
) => applyOperation(tables, confirmed(operation, confirmedFields), faces);

const round = (changes: Record<string, string>) =>
  roundUpdated({ changes } as never);
const update = (changes: Record<string, unknown>, distanceId = "d-1") =>
  distanceUpdated({ distanceId, changes } as never);
const cfg = { totalEnds: 12, arrowsPerEnd: 3, targetFaceId: "face-1" };
const disabledOf = (tables: RoundTables, id: string) =>
  tables.distances.find((d) => d.id === id)?.disabled;

describe("update_round(round.updated)", () => {
  it("未確定の差分は、含まれる項目だけを置き換える", () => {
    // Given
    // When
    const next = apply(base, round({ name: "更新後" }));

    // Then
    expect(next.round.config).toEqual({ ...base.round.config, name: "更新後" });
  });

  it("後勝ち: 同じ項目を続けて更新すると、最後の値になる", () => {
    // Given
    // When
    const next = applyOperations(
      base,
      [pending(round({ name: "A" })), pending(round({ name: "B" }))],
      faces,
    );

    // Then
    expect(next.round.config.name).toBe("B");
  });

  describe("確定済み", () => {
    const op = round({
      name: "N",
      roundDate: "2026-10-01",
      bowType: "compound",
    });

    it("項目ごと: 効いた項目だけを、判定せずに反映する", () => {
      // Given
      // When
      const onlyDate = applyConfirmed(base, op, ["round_date"]);
      const nameAndBow = applyConfirmed(base, op, ["name", "bow_type"]);

      // Then
      expect(onlyDate.round.config).toEqual({
        ...base.round.config,
        roundDate: "2026-10-01",
      });
      expect(nameAndBow.round.config).toEqual({
        ...base.round.config,
        name: "N",
        bowType: "compound",
      });
    });

    it("nullは、差分の全項目が効いたことを表す", () => {
      // Given
      // When
      const next = applyConfirmed(base, op, null);

      // Then
      expect(next.round.config).toEqual({
        name: "N",
        roundDate: "2026-10-01",
        format: "outdoor",
        bowType: "compound",
      });
    });

    it("空は、何も効いていない。差分に無い項目が効いたと返っても反映しない", () => {
      // Given
      // When
      const none = applyConfirmed(base, op, []);
      const notInDiff = applyConfirmed(base, op, ["format"]);

      // Then
      expect(none.round.config).toEqual(base.round.config);
      expect(notInDiff.round.config).toEqual(base.round.config);
    });

    it("formatは、Unmarkedの距離があっても効いたなら反映する", () => {
      // Given
      // When
      const next = applyConfirmed(
        { ...fieldWithUnmarked },
        round({ format: "indoor" }),
        ["format"],
      );

      // Then
      expect(next.round.config.format).toBe("indoor");
    });
  });
});

describe("round.updatedのstatus", () => {
  it("未確定でも状態は常に効き、他の項目は変えない", () => {
    // Given
    expect(base.round.status).toBe("in_progress");

    // When
    const next = apply(base, round({ status: "completed" }));

    // Then
    expect(next.round.status).toBe("completed");
    expect(next.round.config).toEqual(base.round.config);
  });

  it("名前だけの差分は状態を変えない", () => {
    // Given
    const completed = apply(base, round({ status: "completed" }));

    // When
    const next = apply(completed, round({ name: "N" }));

    // Then
    expect(next.round.status).toBe("completed");
  });

  it("後勝ち: 完了の後の入力中へ戻す操作で入力中になる", () => {
    // Given
    // When
    const next = applyOperations(
      base,
      [
        pending(round({ status: "completed" })),
        pending(round({ status: "in_progress" })),
      ],
      faces,
    );

    // Then
    expect(next.round.status).toBe("in_progress");
  });

  it("確定済み: 効いた項目にstatusがあれば反映し、無ければ反映しない", () => {
    // Given
    // When
    const op = round({ name: "N", status: "completed" });
    const withStatus = applyConfirmed(base, op, ["status"]);
    const allFields = applyConfirmed(base, op, null);
    const withoutStatus = applyConfirmed(base, op, ["name"]);
    const noFields = applyConfirmed(base, op, []);

    // Then
    expect(withStatus.round.status).toBe("completed");
    expect(allFields.round.status).toBe("completed");
    expect(withoutStatus.round.status).toBe("in_progress");
    expect(noFields.round.status).toBe("in_progress");
  });

  it("作成の操作から作るテーブルは入力中になる", () => {
    // Given
    // When
    const created = roundTablesFromCreated(
      roundCreated({ distances: [] }) as Extract<
        SyncOperation,
        { type: "round.created" }
      >,
    );

    // Then
    expect(created.round.status).toBe("in_progress");
  });
});

describe("disable_round(round.disabled)", () => {
  it("ラウンド行を削除済みにする", () => {
    // Given
    // When
    const disabled = apply(base, roundDisabled());

    // Then
    expect(disabled.round.disabled).toBe(true);
  });

  it("削除済みのラウンドへの操作は、確定済みでも反映しない", () => {
    // Given
    const disabled = apply(base, roundDisabled());

    // When
    const updated = apply(disabled, roundUpdated());
    const created = apply(
      disabled,
      distanceCreated({ id: "d-9", positionKey: "z" }),
    );
    const recorded = applyConfirmed(disabled, shotRecorded(), null);

    // Then
    expect(updated).toBe(disabled);
    expect(created).toBe(disabled);
    expect(recorded).toBe(disabled);
  });
});

describe("create_distance(distance.created)", () => {
  it("距離の作成は、末尾へ削除されていない距離として追加する", () => {
    // Given
    const op = distanceCreated({ id: "d-2", positionKey: "b" });

    // When
    const next = apply(base, op);

    // Then
    expect(next.distances.map((d) => d.id)).toEqual(["d-1", "d-2"]);
    expect(next.distances[1].disabled).toBe(false);
  });

  it("同じ距離の作成を重ねても、追加しない", () => {
    // Given
    const op = distanceCreated({ id: "d-2", positionKey: "b" });
    const once = apply(base, op);

    // When
    const twice = apply(once, op);

    // Then
    expect(twice).toBe(once);
  });

  it("同じ位置の距離があっても追加する。削除済みの距離の位置も同じ", () => {
    // Given
    const dup = distanceCreated({ id: "d-2", positionKey: "a" });
    const deleted = apply(base, distanceDisabled());

    // When
    const pendingAdded = apply(base, dup);
    const confirmedAdded = applyConfirmed(base, dup, null);
    const afterDeleted = apply(deleted, dup);

    // Then
    expect(pendingAdded.distances.map((d) => d.id)).toEqual(["d-1", "d-2"]);
    expect(confirmedAdded.distances.map((d) => d.id)).toEqual(["d-1", "d-2"]);
    expect(afterDeleted.distances.map((d) => d.id)).toEqual(["d-1", "d-2"]);
  });

  it("同じ位置へ別IDで同時に追加した2件は、適用順によらず両方が効いて並びが同じで、得点が残る", () => {
    // Given
    const first = distanceCreated({ id: "d-2", positionKey: "b" });
    const second = distanceCreated({ id: "d-3", positionKey: "b" });
    const shot = shotRecorded({ distanceId: "d-2" });
    const order = (tables: RoundTables) =>
      [...tables.distances].sort(compareDistancePosition).map((d) => d.id);

    // When
    const a = applyOperations(base, [first, second, shot].map(pending), faces);
    const b = applyOperations(base, [second, first, shot].map(pending), faces);

    // Then
    expect(order(a)).toEqual(["d-1", "d-2", "d-3"]);
    expect(order(b)).toEqual(order(a));
    expect(a.shots.map((s) => s.distance_id)).toEqual(["d-2"]);
    expect(b.shots.map((s) => s.distance_id)).toEqual(["d-2"]);
  });

  it("削除済みの距離と同じIDの作成は、効かない", () => {
    // Given
    const deleted = apply(base, distanceDisabled());

    // When
    const next = apply(
      deleted,
      distanceCreated({ id: "d-1", positionKey: "z" }),
    );

    // Then
    expect(next).toBe(deleted);
  });
});

describe("update_distance(distance.updated)", () => {
  it("存在しない距離への更新は、効かない", () => {
    // Given
    // When
    const next = apply(base, update({ distance: 50 }, "none"));

    // Then
    expect(next).toBe(base);
  });

  it("削除済みの距離への更新は、確定済みでも効かない", () => {
    // Given
    const deleted = apply(base, distanceDisabled());

    // When
    const pendingUpdate = apply(deleted, update({ distance: 50 }));
    const confirmedUpdate = applyConfirmed(
      deleted,
      update({ distance: 50 }),
      null,
    );

    // Then
    expect(pendingUpdate).toBe(deleted);
    expect(confirmedUpdate).toBe(deleted);
  });

  it("差分の項目だけを置き換える", () => {
    // Given
    // When
    const next = apply(
      base,
      update({
        distance: 50,
        config: { ...cfg, targetFaceId: "face-2" },
      }),
    );

    // Then
    expect(next.distances[0]).toMatchObject({
      distance: 50,
      total_ends: 12,
      arrows_per_end: 3,
      target_face_id: "face-2",
      is_marked: true,
      position_key: "a",
    });
  });

  it("後勝ち: 同じ項目を続けて更新すると、最後の値になる", () => {
    // Given
    // When
    const next = applyOperations(
      base,
      [pending(update({ distance: 50 })), pending(update({ distance: 30 }))],
      faces,
    );

    // Then
    expect(next.distances[0].distance).toBe(30);
  });

  describe("構成", () => {
    const withShot = (endNumber: number, scoreStr = "10") =>
      apply(
        base,
        shotRecorded({
          endNumber,
          scoreStr,
          scoreInt: Number(scoreStr),
        }),
      );
    // エンド1の、マス1から指定した番号までに点数を記録した基準(6エンド×6射)。
    const withShotsInEnd1 = (count: number) =>
      Array.from({ length: count }, (_, i) => i + 1).reduce(
        (tables, n) => apply(tables, shotRecorded({ shotNumber: n })),
        base,
      );

    it("表示中の矢が新しい構成の範囲外のマスにあるなら、構成の3項目とも反映せず、同じ保存の他の項目は反映する", () => {
      // Given
      const four = withShotsInEnd1(4);

      // When
      const blocked = apply(four, update({ config: cfg, distance: 40 }));

      // Then
      expect(blocked.distances[0]).toMatchObject({
        total_ends: 6,
        arrows_per_end: 6,
        target_face_id: "face-1",
        distance: 40,
      });
    });

    it("的が変わって矢の得点が無効になるなら、反映しない", () => {
      // Given
      const nine = withShot(1, "9");
      const ten = withShot(1, "10");

      // When
      const changeFace = {
        totalEnds: 6,
        arrowsPerEnd: 6,
        targetFaceId: "face-2",
      };
      const nineResult = apply(nine, update({ config: changeFace }));
      const tenResult = apply(ten, update({ config: changeFace }));

      // Then
      expect(nineResult.distances[0].target_face_id).toBe("face-2");
      expect(tenResult.distances[0].target_face_id).toBe("face-1");
    });

    it("取り消した矢は、構成の判定に含めない", () => {
      // Given
      const cleared = apply(withShotsInEnd1(4), shotCleared({ shotNumber: 4 }));

      // When
      const next = apply(cleared, update({ config: cfg }));

      // Then
      expect(next.distances[0]).toMatchObject({
        total_ends: 12,
        arrows_per_end: 3,
      });
    });

    it("矢の数が少なくても、マスの番号が新しい射数/エンドを超える矢があれば反映せず、最後の番号なら反映する", () => {
      // Given
      const lastNumber = apply(base, shotRecorded({ shotNumber: 3 }));
      const beyondNumber = apply(base, shotRecorded({ shotNumber: 4 }));

      // When
      const exactly = apply(lastNumber, update({ config: cfg }));
      const exceeding = apply(beyondNumber, update({ config: cfg }));

      // Then
      expect(exactly.distances[0].arrows_per_end).toBe(3);
      expect(exceeding.distances[0].arrows_per_end).toBe(6);
    });

    it("全てのマスが埋まった距離は、同じ構成なら反映する(数でなくマスの範囲で判定する)", () => {
      // Given
      const allCells = withShotsInEnd1(6);

      // When
      const next = apply(
        allCells,
        update({ config: { ...cfg, arrowsPerEnd: 6 } }),
      );

      // Then
      expect(next.distances[0].total_ends).toBe(12);
    });

    it("エンド番号が新しいエンド数を超える矢があれば反映せず、最後のエンドなら反映する", () => {
      // Given
      const lastEnd = withShot(4);
      const beyondEnd = withShot(5);
      const fewerEnds = {
        totalEnds: 4,
        arrowsPerEnd: 6,
        targetFaceId: "face-1",
      };

      // When
      const exactly = apply(lastEnd, update({ config: fewerEnds }));
      const exceeding = apply(beyondEnd, update({ config: fewerEnds }));

      // Then
      expect(exactly.distances[0].total_ends).toBe(4);
      expect(exceeding.distances[0].total_ends).toBe(6);
    });

    it("確定済みの構成は、矢の値もマスも変えず引き継ぐ(取り除かない)", () => {
      // Given
      const withShots = apply(withShot(5), shotRecorded({ shotNumber: 2 }));

      // When
      const next = applyConfirmed(withShots, update({ config: cfg }), [
        "config",
      ]);

      // Then
      expect(next.distances[0].total_ends).toBe(12);
      expect(next.shots).toEqual(withShots.shots);
      expect(next.shots.map((s) => [s.end_number, s.shot_number])).toEqual([
        [5, 1],
        [1, 2],
      ]);
    });
  });

  describe("確定済み", () => {
    it("項目ごと: 効いた項目だけを反映する", () => {
      // Given
      const op = update({ distance: 50, isMarked: false, config: cfg });

      // When
      const onlyDistance = applyConfirmed(field, op, ["distance"]);
      const onlyConfig = applyConfirmed(field, op, ["config"]);
      const onlyMarked = applyConfirmed(field, op, ["is_marked"]);

      // Then
      expect(onlyDistance.distances[0]).toMatchObject({
        distance: 50,
        is_marked: true,
        total_ends: 6,
      });
      expect(onlyConfig.distances[0]).toMatchObject({
        distance: 70,
        total_ends: 12,
      });
      expect(onlyMarked.distances[0]).toMatchObject({
        is_marked: false,
        distance: 70,
      });
    });

    it("nullは差分の全項目が効いたことを表し、空は何も効いていない", () => {
      // Given
      const op = update({ distance: 50, config: cfg });

      // When
      const all = applyConfirmed(base, op, null);
      const none = applyConfirmed(base, op, []);

      // Then
      expect(all.distances[0]).toMatchObject({
        distance: 50,
        total_ends: 12,
      });
      expect(none.distances[0]).toEqual(base.distances[0]);
    });

    it("効いたと確定した項目は、規則の判定をせずに反映する", () => {
      // Given
      // When
      const next = applyConfirmed(
        fieldWithUnmarked,
        update({ isMarked: true }),
        ["is_marked"],
      );

      // Then
      expect(next.distances[0].is_marked).toBe(true);
    });
  });
});

describe("disable_distance(distance.disabled)", () => {
  it("距離の行を削除済みにし、矢の行は残す", () => {
    // Given
    const withShot = apply(base, shotRecorded());

    // When
    const next = apply(withShot, distanceDisabled());

    // Then
    expect(disabledOf(next, "d-1")).toBe(true);
    expect(next.shots).toEqual(withShot.shots);
  });

  it("存在しない距離と、削除済みの距離への削除は、効かない", () => {
    // Given
    const deleted = apply(base, distanceDisabled());

    // When
    const unknown = apply(base, distanceDisabled("none"));
    const again = apply(deleted, distanceDisabled());

    // Then
    expect(unknown).toBe(base);
    expect(again).toBe(deleted);
  });
});

// 取得した行のように、射手を持つ矢の行を足した表。既定はマス(d-1、エンド1、マス1)。
const withShotRow = (
  tables: RoundTables,
  overrides: Partial<ShotRow> = {},
): RoundTables => ({
  ...tables,
  shots: [
    ...tables.shots,
    {
      distance_id: "d-1",
      end_number: 1,
      shot_number: 1,
      score_str: "10",
      score_int: 10,
      disabled: false,
      ...overrides,
    },
  ],
});

describe("record_shots(shot.recorded)", () => {
  // 12エンド×3射の距離の基準。
  const threeArrows: RoundTables = {
    ...base,
    distances: [{ ...base.distances[0], total_ends: 12, arrows_per_end: 3 }],
  };
  const cellsOf = (tables: RoundTables) =>
    tables.shots.map((s) => [s.end_number, s.shot_number, s.score_str]);

  it("空のマスへの記録は、そのマスの行として足す。同じエンドの別のマスの記録は互いに残る", () => {
    // Given
    const first = apply(base, shotRecorded({ shotNumber: 1 }));

    // When
    const second = apply(
      first,
      shotRecorded({ shotNumber: 2, scoreStr: "9", scoreInt: 9 }),
    );

    // Then
    expect(cellsOf(second)).toEqual([
      [1, 1, "10"],
      [1, 2, "9"],
    ]);
    expect(second.shots[0]).not.toHaveProperty("shooter_id");
  });

  it("同じマスの記録は、点数だけを置き換え、行の射手を残す", () => {
    // Given
    const recorded = withShotRow(base, { shooter_id: "u-2" });

    // When
    const next = apply(recorded, shotRecorded({ scoreStr: "9", scoreInt: 9 }));

    // Then
    expect(next.shots).toEqual([
      expect.objectContaining({
        end_number: 1,
        shot_number: 1,
        score_str: "9",
        shooter_id: "u-2",
      }),
    ]);
  });

  it("取り消したマスへの記録は、行を復活させて新しい点数にし、行の射手を引き継ぐ", () => {
    // Given
    const cleared = withShotRow(base, { shooter_id: "u-2", disabled: true });

    // When
    const revived = apply(
      cleared,
      shotRecorded({ scoreStr: "9", scoreInt: 9 }),
    );

    // Then
    expect(revived.shots).toEqual([
      expect.objectContaining({
        score_str: "9",
        shooter_id: "u-2",
        disabled: false,
      }),
    ]);
  });

  it("別の距離・別のエンドの同じ番号のマスは、別のマスとして足す", () => {
    // Given
    const withTwo = apply(
      base,
      distanceCreated({ id: "d-2", positionKey: "b" }),
    );
    const recorded = apply(withTwo, shotRecorded());

    // When
    const otherEnd = apply(recorded, shotRecorded({ endNumber: 2 }));
    const otherDistance = apply(recorded, shotRecorded({ distanceId: "d-2" }));

    // Then
    expect(otherEnd.shots).toHaveLength(2);
    expect(otherDistance.shots).toHaveLength(2);
  });

  it("未確定の矢は、現在の構成で無効(範囲外のエンド・番号、的に無い点数)なら、同じマスの先の矢も置き換えない", () => {
    // Given
    const first = apply(base, shotRecorded({ scoreStr: "9", scoreInt: 9 }));

    // When
    const outOfEnds = apply(first, shotRecorded({ endNumber: 7 }));
    const outOfNumbers = apply(first, shotRecorded({ shotNumber: 7 }));
    const numberZero = apply(first, shotRecorded({ shotNumber: 0 }));
    const offRing = apply(first, shotRecorded({ scoreStr: "7", scoreInt: 7 }));

    // Then
    expect(outOfEnds).toBe(first);
    expect(outOfNumbers).toBe(first);
    expect(numberZero).toBe(first);
    expect(offRing).toBe(first);
  });

  it("未確定の矢は、エンドは1と総エンド数、番号は1と射数/エンドまで重ねる", () => {
    // Given

    // When
    const firstCell = apply(
      base,
      shotRecorded({ endNumber: 1, shotNumber: 1 }),
    );
    const lastCell = apply(base, shotRecorded({ endNumber: 6, shotNumber: 6 }));

    // Then
    expect(cellsOf(firstCell)).toEqual([[1, 1, "10"]]);
    expect(cellsOf(lastCell)).toEqual([[6, 6, "10"]]);
  });

  describe("マスの範囲と上限", () => {
    // 射数/エンドの3マスを全て埋めたエンド1。
    const full = [1, 2, 3].reduce(
      (tables, shotNumber) => apply(tables, shotRecorded({ shotNumber })),
      threeArrows,
    );

    it("全てのマスが埋まっていても、同じマスへの記録は点数を置き換え、行の数は増えない", () => {
      // Given

      // When
      const next = apply(
        full,
        shotRecorded({ shotNumber: 2, scoreStr: "9", scoreInt: 9 }),
      );

      // Then
      expect(cellsOf(next)).toEqual([
        [1, 1, "10"],
        [1, 2, "9"],
        [1, 3, "10"],
      ]);
    });

    it("射数/エンドを超える番号のマスは、満杯でも空きがあっても重ねない", () => {
      // Given
      const partial = apply(threeArrows, shotRecorded({ shotNumber: 1 }));

      // When
      const afterFull = apply(full, shotRecorded({ shotNumber: 4 }));
      const afterPartial = apply(partial, shotRecorded({ shotNumber: 4 }));

      // Then
      expect(afterFull).toBe(full);
      expect(afterPartial).toBe(partial);
    });

    it("消したマスへの記録は、他のマスが埋まっていても復活させる", () => {
      // Given
      const cleared = apply(full, shotCleared({ shotNumber: 1 }));

      // When
      const revived = apply(cleared, shotRecorded({ shotNumber: 1 }));

      // Then
      expect(revived.shots.map((s) => s.disabled)).toEqual([
        false,
        false,
        false,
      ]);
    });
  });

  it("確定済みの矢の記録は、サーバーが他の項目を効かせても、点数だけを重ねる", () => {
    // Given
    const recorded = withShotRow(base, { shooter_id: "u-2" });

    // When
    const next = applyConfirmed(
      recorded,
      shotRecorded({ scoreStr: "9", scoreInt: 9 }),
      ["score", "shooter_id"],
    );

    // Then
    expect(next.shots).toEqual([
      expect.objectContaining({ score_str: "9", shooter_id: "u-2" }),
    ]);
  });

  it("確定済みの矢は、構成の判定をせずに反映し、構成が狭まっていても重ねる", () => {
    // Given
    const narrow: RoundTables = {
      ...base,
      distances: [{ ...base.distances[0], total_ends: 1, arrows_per_end: 1 }],
    };

    // When
    const outOfEnds = applyConfirmed(
      base,
      shotRecorded({ endNumber: 7 }),
      null,
    );
    const outOfNumbers = applyConfirmed(
      narrow,
      shotRecorded({ shotNumber: 2 }),
      null,
    );

    // Then
    expect(outOfEnds.shots).toHaveLength(1);
    expect(outOfNumbers.shots).toHaveLength(1);
  });

  it("存在しない距離と、削除済みの距離への記録は、効かない", () => {
    // Given
    const deleted = apply(base, distanceDisabled());

    // When
    const unknown = apply(base, shotRecorded({ distanceId: "none" }));
    const onDeleted = apply(deleted, shotRecorded());

    // Then
    expect(unknown).toBe(base);
    expect(onDeleted).toBe(deleted);
  });
});

describe("clear_shots(shot.cleared)", () => {
  it("同じマスの行を、射手を残したまま削除済みにする", () => {
    // Given
    const withShot = withShotRow(base, { shooter_id: "u-2" });

    // When
    const next = apply(withShot, shotCleared());

    // Then
    expect(next.shots).toEqual([
      expect.objectContaining({
        end_number: 1,
        shot_number: 1,
        disabled: true,
        shooter_id: "u-2",
      }),
    ]);
  });

  it("行が無いマスと、削除済みのマスの取り消しは、何もしない", () => {
    // Given
    const cleared = withShotRow(base, { disabled: true });

    // When
    const empty = apply(base, shotCleared());
    const again = apply(cleared, shotCleared());

    // Then
    expect(empty).toBe(base);
    expect(again).toBe(cleared);
  });

  it("同じエンドの別のマスは消さない", () => {
    // Given
    const two = apply(
      apply(base, shotRecorded()),
      shotRecorded({ shotNumber: 2 }),
    );

    // When
    const next = apply(two, shotCleared({ shotNumber: 2 }));

    // Then
    expect(next.shots.map((s) => [s.shot_number, s.disabled])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("存在しない距離、削除済みの距離、矢の無い別の距離のマスの取り消しは、効かない", () => {
    // Given
    const withTwo = apply(
      apply(base, distanceCreated({ id: "d-2", positionKey: "b" })),
      shotRecorded(),
    );
    const withShot = apply(apply(base, shotRecorded()), distanceDisabled());

    // When
    const unknown = apply(base, shotCleared({ distanceId: "none" }));
    const otherDistance = apply(withTwo, shotCleared({ distanceId: "d-2" }));
    const onDeleted = apply(withShot, shotCleared());

    // Then
    expect(unknown).toBe(base);
    expect(otherDistance).toBe(withTwo);
    expect(onDeleted).toBe(withShot);
  });
});

describe("round.created", () => {
  it("作成の操作から、ラウンドの設定と距離を持つ矢の無いテーブルを作る", () => {
    // Given
    const operation = roundCreated();
    if (operation.type !== "round.created") throw new Error("type");

    // When
    const tables = roundTablesFromCreated(operation);

    // Then
    expect(tables).toEqual({
      round: {
        config: {
          name: "",
          roundDate: "2026-09-29",
          format: "indoor",
          bowType: "compound",
        },
        status: "in_progress",
        disabled: false,
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
          disabled: false,
        },
      ],
      shots: [],
    });
  });

  it("基準が作成の操作から作られているため、重ねても変えない", () => {
    // Given
    const operation = roundCreated();
    if (operation.type !== "round.created") throw new Error("type");
    const tables = roundTablesFromCreated(operation);

    // When
    const next = apply(tables, operation);

    // Then
    expect(next).toBe(tables);
  });
});

describe("applyOperations", () => {
  const ops = [
    roundUpdated(),
    distanceCreated({ id: "d-2", positionKey: "b" }),
    shotRecorded(),
    shotRecorded({ shotNumber: 2, eventId: "e-2" }),
    shotCleared({ shotNumber: 3, distanceId: "d-2" }),
    distanceUpdated(),
  ].map(pending);

  it("同じ操作の列を重ねて適用しても、結果は変わらない(冪等)", () => {
    // Given
    const once = applyOperations(base, ops, faces);

    // When
    const twice = applyOperations(once, ops, faces);

    // Then
    expect(twice).toEqual(once);
  });

  it("衝突しない操作の入れ替えは、結果を変えない", () => {
    // Given
    const a = shotRecorded({ shotNumber: 1 });
    const b = shotRecorded({ shotNumber: 2, eventId: "e-2" });
    expect(conflicts(a, b)).toBe(false);

    // When
    const ab = applyOperations(base, [pending(a), pending(b)], faces);
    const ba = applyOperations(base, [pending(b), pending(a)], faces);

    // Then
    const byNumber = (x: { shot_number: number }, y: { shot_number: number }) =>
      x.shot_number - y.shot_number;
    expect([...ab.shots].sort(byNumber)).toEqual([...ba.shots].sort(byNumber));
  });

  it("同じマスの操作は、適用の順で最後の操作の結果が残る", () => {
    // Given
    const nine = shotRecorded({ scoreStr: "9", scoreInt: 9 });
    const ten = shotRecorded({ scoreStr: "10", scoreInt: 10 });
    const clear = shotCleared();

    // When
    const nineThenTen = applyOperations(
      base,
      [pending(nine), pending(ten)],
      faces,
    );
    const tenThenNine = applyOperations(
      base,
      [pending(ten), pending(nine)],
      faces,
    );
    const recordThenClear = applyOperations(
      base,
      [pending(nine), pending(clear)],
      faces,
    );
    const clearThenRecord = applyOperations(
      base,
      [pending(clear), pending(nine)],
      faces,
    );

    // Then
    expect(nineThenTen.shots.map((s) => s.score_str)).toEqual(["10"]);
    expect(tenThenNine.shots.map((s) => s.score_str)).toEqual(["9"]);
    expect(recordThenClear.shots.map((s) => s.disabled)).toEqual([true]);
    expect(clearThenRecord.shots.map((s) => s.disabled)).toEqual([false]);
  });

  it("操作が無ければ基準をそのまま返す", () => {
    // Given

    // When
    const next = applyOperations(base, [], faces);

    // Then
    expect(next).toBe(base);
  });
});
