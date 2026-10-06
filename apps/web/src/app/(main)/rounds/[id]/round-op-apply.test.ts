import { describe, expect, it } from "vitest";
import { conflicts } from "../_shared/round-op-conflicts";
import {
  distanceCreated,
  distanceDisabled,
  distanceUpdated,
  roundCreated,
  roundDisabled,
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "../_shared/round-op-test-helpers";
import type { SyncOperation } from "../_shared/sync-events";
import {
  type AppliedOperation,
  applyOperation,
  applyOperations,
} from "./round-op-apply";
import {
  type RoundTables,
  roundTablesFromCreated,
  roundTablesFromServer,
} from "./round-tables";
import type { ScoringTargetFace } from "./scorecard-scoring";

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
const cfg = { totalEnds: 3, arrowsPerEnd: 3, targetFaceId: "face-1" };
const disabledOf = (tables: RoundTables, id: string) =>
  tables.distances.find((d) => d.id === id)?.disabled;

describe("update_round(round.updated)", () => {
  it("未確定の差分は、含まれる項目だけを置き換える", () => {
    const next = apply(base, round({ name: "更新後" }));
    expect(next.round.config).toEqual({ ...base.round.config, name: "更新後" });
  });

  it("後勝ち: 同じ項目を続けて更新すると、最後の値になる", () => {
    const next = applyOperations(
      base,
      [pending(round({ name: "A" })), pending(round({ name: "B" }))],
      faces,
    );
    expect(next.round.config.name).toBe("B");
  });

  it("未確定でも、Unmarkedの距離があるときはフィールド以外へ変えない", () => {
    const blocked = apply(
      fieldWithUnmarked,
      round({ format: "indoor", name: "N" }),
    );
    expect(blocked.round.config.format).toBe("field");
    expect(blocked.round.config.name).toBe("N");
    expect(
      apply(fieldWithUnmarked, round({ format: "field" })).round.config.format,
    ).toBe("field");
    const ok = apply(
      base,
      round({ format: "indoor", roundDate: "2026-10-01" }),
    );
    expect(ok.round.config).toMatchObject({
      format: "indoor",
      roundDate: "2026-10-01",
    });
  });

  it("削除済みのUnmarkedの距離は、フォーマット変更を妨げない", () => {
    const deleted = apply(fieldWithUnmarked, distanceDisabled());
    expect(
      apply(deleted, round({ format: "indoor" })).round.config.format,
    ).toBe("indoor");
  });

  describe("確定済み", () => {
    const op = round({
      name: "N",
      roundDate: "2026-10-01",
      bowType: "compound",
    });

    it("項目ごと: 効いた項目だけを、判定せずに反映する", () => {
      expect(applyConfirmed(base, op, ["round_date"]).round.config).toEqual({
        ...base.round.config,
        roundDate: "2026-10-01",
      });
      expect(
        applyConfirmed(base, op, ["name", "bow_type"]).round.config,
      ).toEqual({ ...base.round.config, name: "N", bowType: "compound" });
    });

    it("nullは、差分の全項目が効いたことを表す", () => {
      expect(applyConfirmed(base, op, null).round.config).toEqual({
        name: "N",
        roundDate: "2026-10-01",
        format: "outdoor",
        bowType: "compound",
      });
    });

    it("空は、何も効いていない。差分に無い項目が効いたと返っても反映しない", () => {
      expect(applyConfirmed(base, op, []).round.config).toEqual(
        base.round.config,
      );
      expect(applyConfirmed(base, op, ["format"]).round.config).toEqual(
        base.round.config,
      );
    });

    it("formatは、Unmarkedの距離があっても効いたなら反映する", () => {
      const next = applyConfirmed(
        { ...fieldWithUnmarked },
        round({ format: "indoor" }),
        ["format"],
      );
      expect(next.round.config.format).toBe("indoor");
    });
  });
});

describe("round.updatedのstatus", () => {
  it("未確定でも状態は常に効き、他の項目は変えない", () => {
    // Given: 入力中の基準
    expect(base.round.status).toBe("in_progress");

    // When
    const next = apply(base, round({ status: "completed" }));

    // Then
    expect(next.round.status).toBe("completed");
    expect(next.round.config).toEqual(base.round.config);
  });

  it("Unmarkedの距離でformatが効かなくても、同じ差分の状態は効く", () => {
    const next = apply(
      fieldWithUnmarked,
      round({ format: "indoor", status: "completed" }),
    );
    expect(next.round.config.format).toBe("field");
    expect(next.round.status).toBe("completed");
  });

  it("名前だけの差分は状態を変えない", () => {
    const completed = apply(base, round({ status: "completed" }));
    expect(apply(completed, round({ name: "N" })).round.status).toBe(
      "completed",
    );
  });

  it("後勝ち: 完了の後の入力中へ戻す操作で入力中になる", () => {
    const next = applyOperations(
      base,
      [
        pending(round({ status: "completed" })),
        pending(round({ status: "in_progress" })),
      ],
      faces,
    );
    expect(next.round.status).toBe("in_progress");
  });

  it("確定済み: 効いた項目にstatusがあれば反映し、無ければ反映しない", () => {
    const op = round({ name: "N", status: "completed" });
    expect(applyConfirmed(base, op, ["status"]).round.status).toBe("completed");
    expect(applyConfirmed(base, op, null).round.status).toBe("completed");
    expect(applyConfirmed(base, op, ["name"]).round.status).toBe("in_progress");
    expect(applyConfirmed(base, op, []).round.status).toBe("in_progress");
  });

  it("作成の操作から作るテーブルは入力中になる", () => {
    const created = roundTablesFromCreated(
      roundCreated() as Extract<SyncOperation, { type: "round.created" }>,
    );
    expect(created.round.status).toBe("in_progress");
  });
});

describe("disable_round(round.disabled)", () => {
  it("ラウンド行を削除済みにし、それ以降の操作は反映しない", () => {
    const disabled = apply(base, roundDisabled());
    expect(disabled.round.disabled).toBe(true);
    expect(apply(disabled, roundUpdated())).toBe(disabled);
    expect(
      apply(disabled, distanceCreated({ id: "d-9", positionKey: "z" })),
    ).toBe(disabled);
    expect(applyConfirmed(disabled, shotRecorded(), null)).toBe(disabled);
  });
});

describe("create_distance(distance.created)", () => {
  it("末尾へ追加し、同じ距離を重ねて追加しない", () => {
    const op = distanceCreated({ id: "d-2", positionKey: "b" });
    const once = apply(base, op);
    expect(once.distances.map((d) => d.id)).toEqual(["d-1", "d-2"]);
    expect(once.distances[1].disabled).toBe(false);
    expect(apply(once, op)).toBe(once);
  });

  it("同じ位置の距離があれば追加しない。削除済みの距離の位置も重複として扱う", () => {
    const dup = distanceCreated({ id: "d-2", positionKey: "a" });
    expect(apply(base, dup)).toBe(base);
    expect(applyConfirmed(base, dup, null)).toBe(base);
    const deleted = apply(base, distanceDisabled());
    expect(apply(deleted, dup)).toBe(deleted);
  });

  it("削除済みの距離と同じIDの作成は、効かない", () => {
    const deleted = apply(base, distanceDisabled());
    expect(
      apply(deleted, distanceCreated({ id: "d-1", positionKey: "z" })),
    ).toBe(deleted);
  });

  it("未確定のUnmarkedの距離は、フィールド以外のラウンドには作らない", () => {
    const op = distanceCreated({
      id: "d-2",
      positionKey: "b",
      isMarked: false,
      distance: null,
    });
    expect(apply(base, op)).toBe(base);
    expect(apply(field, op).distances).toHaveLength(2);
    expect(applyConfirmed(base, op, null).distances).toHaveLength(2);
  });
});

describe("update_distance(distance.updated)", () => {
  it("存在しない距離への更新は、効かない", () => {
    expect(apply(base, update({ distance: 50 }, "none"))).toBe(base);
  });

  it("削除済みの距離への更新は、確定済みでも効かない", () => {
    const deleted = apply(base, distanceDisabled());
    expect(apply(deleted, update({ distance: 50 }))).toBe(deleted);
    expect(applyConfirmed(deleted, update({ distance: 50 }), null)).toBe(
      deleted,
    );
  });

  it("差分の項目だけを置き換える", () => {
    const next = apply(
      base,
      update({
        distance: 50,
        config: { ...cfg, targetFaceId: "face-2" },
      }),
    );
    expect(next.distances[0]).toMatchObject({
      distance: 50,
      total_ends: 3,
      arrows_per_end: 3,
      target_face_id: "face-2",
      is_marked: true,
      position_key: "a",
    });
  });

  it("後勝ち: 同じ項目を続けて更新すると、最後の値になる", () => {
    const next = applyOperations(
      base,
      [pending(update({ distance: 50 })), pending(update({ distance: 30 }))],
      faces,
    );
    expect(next.distances[0].distance).toBe(30);
  });

  describe("Marked/Unmarked", () => {
    it("Markedへ変えるとき距離(m)が無ければ、Markedにしない", () => {
      expect(
        apply(fieldWithUnmarked, update({ isMarked: true })).distances[0]
          .is_marked,
      ).toBe(false);
    });

    it("Markedへ変えるとき、同じ操作の距離(m)があれば、その値で判定して即Markedになる", () => {
      const next = apply(
        fieldWithUnmarked,
        update({ isMarked: true, distance: 30 }),
      );
      expect(next.distances[0]).toMatchObject({
        is_marked: true,
        distance: 30,
      });
    });

    it("同じ操作の距離(m)がnullなら、Markedにしない。距離(m)の後の判定でもnullは効く", () => {
      const next = apply(
        fieldWithUnmarked,
        update({ isMarked: true, distance: null }),
      );
      expect(next.distances[0]).toMatchObject({
        is_marked: false,
        distance: null,
      });
    });

    it("Unmarkedへ変えるのは、フィールドのときだけ", () => {
      expect(
        apply(base, update({ isMarked: false })).distances[0].is_marked,
      ).toBe(true);
      expect(
        apply(field, update({ isMarked: false })).distances[0].is_marked,
      ).toBe(false);
    });

    it("Markedのまま距離(m)を空にしない。同じ操作でUnmarkedへ変わるなら空にできる", () => {
      expect(
        apply(base, update({ distance: null })).distances[0].distance,
      ).toBe(70);
      const next = apply(field, update({ isMarked: false, distance: null }));
      expect(next.distances[0]).toMatchObject({
        is_marked: false,
        distance: null,
      });
    });
  });

  describe("構成", () => {
    const withShot = (endNumber: number, scoreStr = "10") =>
      apply(
        base,
        shotRecorded({ endNumber, scoreStr, scoreInt: Number(scoreStr) }),
      );

    it("表示中の矢が新しい構成で無効になるなら、構成の3項目とも反映しない", () => {
      const blocked = apply(withShot(5), update({ config: cfg, distance: 40 }));
      expect(blocked.distances[0]).toMatchObject({
        total_ends: 6,
        distance: 40,
      });
    });

    it("的が変わって矢の得点が無効になるなら、反映しない", () => {
      const changeFace = { ...cfg, totalEnds: 6, targetFaceId: "face-2" };
      expect(
        apply(withShot(1, "9"), update({ config: changeFace })).distances[0]
          .target_face_id,
      ).toBe("face-2");
      expect(
        apply(withShot(1, "10"), update({ config: changeFace })).distances[0]
          .target_face_id,
      ).toBe("face-1");
    });

    it("取り消した矢は、構成の判定に含めない", () => {
      const cleared = apply(withShot(5), shotCleared({ endNumber: 5 }));
      expect(
        apply(cleared, update({ config: cfg })).distances[0].total_ends,
      ).toBe(3);
    });

    it("確定済みの構成は、矢の値も位置も変えず引き継ぐ(取り除かない)", () => {
      const withShots = apply(withShot(5), shotRecorded());
      const next = applyConfirmed(withShots, update({ config: cfg }), [
        "config",
      ]);
      expect(next.distances[0].total_ends).toBe(3);
      expect(next.shots).toEqual(withShots.shots);
      expect(next.shots.map((s) => s.end_number)).toEqual([5, 1]);
    });
  });

  describe("確定済み", () => {
    it("項目ごと: 効いた項目だけを反映する", () => {
      const op = update({ distance: 50, isMarked: false, config: cfg });
      expect(applyConfirmed(base, op, ["distance"]).distances[0]).toMatchObject(
        { distance: 50, is_marked: true, total_ends: 6 },
      );
      expect(applyConfirmed(base, op, ["config"]).distances[0]).toMatchObject({
        distance: 70,
        total_ends: 3,
      });
      expect(
        applyConfirmed(base, op, ["is_marked"]).distances[0],
      ).toMatchObject({ is_marked: false, distance: 70 });
    });

    it("nullは差分の全項目が効いたことを表し、空は何も効いていない", () => {
      const op = update({ distance: 50, config: cfg });
      expect(applyConfirmed(base, op, null).distances[0]).toMatchObject({
        distance: 50,
        total_ends: 3,
      });
      expect(applyConfirmed(base, op, []).distances[0]).toEqual(
        base.distances[0],
      );
    });

    it("効いたと確定した項目は、規則の判定をせずに反映する", () => {
      const next = applyConfirmed(
        fieldWithUnmarked,
        update({ isMarked: true }),
        ["is_marked"],
      );
      expect(next.distances[0].is_marked).toBe(true);
    });
  });
});

describe("disable_distance(distance.disabled)", () => {
  it("距離の行を削除済みにし、矢の行は残す", () => {
    const withShot = apply(base, shotRecorded());
    const next = apply(withShot, distanceDisabled());
    expect(disabledOf(next, "d-1")).toBe(true);
    expect(next.shots).toEqual(withShot.shots);
  });

  it("存在しない距離と、削除済みの距離への削除は、効かない", () => {
    expect(apply(base, distanceDisabled("none"))).toBe(base);
    const deleted = apply(base, distanceDisabled());
    expect(apply(deleted, distanceDisabled())).toBe(deleted);
  });
});

describe("record_shots(shot.recorded)", () => {
  it("同じマスを置き換える", () => {
    const first = apply(base, shotRecorded({ scoreStr: "9", scoreInt: 9 }));
    const second = apply(first, shotRecorded());
    expect(second.shots).toEqual([
      expect.objectContaining({
        score_str: "10",
        score_int: 10,
        disabled: false,
      }),
    ]);
  });

  it("取り消したマスへの記録は、同じ行を復活させる", () => {
    const cleared = apply(apply(base, shotRecorded()), shotCleared());
    expect(cleared.shots[0].disabled).toBe(true);
    const revived = apply(
      cleared,
      shotRecorded({ scoreStr: "9", scoreInt: 9 }),
    );
    expect(revived.shots).toEqual([
      expect.objectContaining({ score_str: "9", disabled: false }),
    ]);
  });

  it("未確定の矢は、現在の構成で無効なら先のマスの矢も置き換えない", () => {
    const first = apply(base, shotRecorded({ scoreStr: "9", scoreInt: 9 }));
    expect(apply(first, shotRecorded({ endNumber: 7 }))).toBe(first);
    expect(apply(first, shotRecorded({ scoreStr: "7", scoreInt: 7 }))).toBe(
      first,
    );
    const outOfRange = apply(first, shotRecorded({ endNumber: 7 }));
    expect(outOfRange.shots).toHaveLength(1);
  });

  it("確定済みの矢は、判定せずに反映する", () => {
    expect(
      applyConfirmed(base, shotRecorded({ endNumber: 7 }), null).shots,
    ).toHaveLength(1);
  });

  it("存在しない距離と、削除済みの距離への記録は、効かない", () => {
    expect(apply(base, shotRecorded({ distanceId: "none" }))).toBe(base);
    const deleted = apply(base, distanceDisabled());
    expect(apply(deleted, shotRecorded())).toBe(deleted);
  });
});

describe("clear_shots(shot.cleared)", () => {
  it("マスの行を削除済みにして残す。行が無ければ何もしない", () => {
    const withShot = apply(base, shotRecorded());
    const next = apply(withShot, shotCleared());
    expect(next.shots).toEqual([
      expect.objectContaining({ end_number: 1, disabled: true }),
    ]);
    expect(apply(base, shotCleared())).toBe(base);
  });

  it("存在しない距離と、削除済みの距離の取り消しは、効かない", () => {
    expect(apply(base, shotCleared({ distanceId: "none" }))).toBe(base);
    const withShot = apply(apply(base, shotRecorded()), distanceDisabled());
    expect(apply(withShot, shotCleared())).toBe(withShot);
  });
});

describe("round.created", () => {
  it("作成の操作から、ラウンドの設定と距離を持つ矢の無いテーブルを作る", () => {
    const operation = roundCreated();
    if (operation.type !== "round.created") throw new Error("type");

    expect(roundTablesFromCreated(operation)).toEqual({
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
    const operation = roundCreated();
    if (operation.type !== "round.created") throw new Error("type");
    const tables = roundTablesFromCreated(operation);

    expect(apply(tables, operation)).toBe(tables);
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
