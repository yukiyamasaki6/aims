import { describe, expect, it } from "vitest";
import {
  applyOperation,
  applyOperations,
  type RoundState,
} from "./round-op-apply";
import { conflicts } from "./round-op-conflicts";
import {
  distanceCreated,
  distanceDisabled,
  distanceUpdated,
  roundDisabled,
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "./round-op-test-helpers";

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

describe("applyOperation", () => {
  it("ラウンド設定の更新は、設定を置き換える", () => {
    const state = applyOperation(base, roundUpdated({ name: "更新後" }));
    expect(state.roundConfig).toEqual({
      name: "更新後",
      roundDate: "2026-09-15",
      format: "outdoor",
      bowType: "recurve",
    });
  });

  it("距離の作成は末尾へ追加し、同じ距離を重ねて追加しない", () => {
    const op = distanceCreated({ id: "d-2", positionKey: "b" });
    const once = applyOperation(base, op);
    expect(once.distances.map((d) => d.id)).toEqual(["d-1", "d-2"]);
    expect(applyOperation(once, op)).toBe(once);
  });

  it("距離の更新は、その距離の設定を置き換える", () => {
    const state = applyOperation(base, distanceUpdated());
    expect(state.distances[0]).toMatchObject({
      distance: 50,
      total_ends: 3,
      arrows_per_end: 3,
      target_face_id: "face-2",
      is_marked: false,
    });
  });

  it("距離の削除は、距離とその記録を除く", () => {
    const withShot = applyOperation(base, shotRecorded());
    const state = applyOperation(withShot, distanceDisabled());
    expect(state.distances).toEqual([]);
    expect(state.shots).toEqual([]);
  });

  it("矢の記録は、同じマスを置き換え、取り消しは除く", () => {
    const first = applyOperation(
      base,
      shotRecorded({ scoreStr: "9", scoreInt: 9 }),
    );
    const second = applyOperation(first, shotRecorded());
    expect(second.shots).toEqual([
      expect.objectContaining({ score_str: "10", score_int: 10 }),
    ]);
    expect(applyOperation(second, shotCleared()).shots).toEqual([]);
  });

  it("ラウンドの削除以降の操作は、反映しない", () => {
    const disabled = applyOperation(base, roundDisabled());
    expect(disabled.roundDisabled).toBe(true);
    expect(applyOperation(disabled, roundUpdated({ name: "無視" }))).toBe(
      disabled,
    );
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
  ];

  it("同じ操作の列を重ねて適用しても、結果は変わらない(冪等)", () => {
    const once = applyOperations(base, ops);
    expect(applyOperations(once, ops)).toEqual(once);
  });

  it("衝突しない操作の入れ替えは、結果を変えない", () => {
    const a = shotRecorded({ arrowNumber: 1 });
    const b = shotRecorded({ arrowNumber: 2, eventId: "e-2" });
    expect(conflicts(a, b)).toBe(false);
    const ab = applyOperations(base, [a, b]);
    const ba = applyOperations(base, [b, a]);
    expect(
      [...ab.shots].sort((x, y) => x.arrow_number - y.arrow_number),
    ).toEqual([...ba.shots].sort((x, y) => x.arrow_number - y.arrow_number));
  });

  it("操作が無ければ基準をそのまま返す", () => {
    expect(applyOperations(base, [])).toBe(base);
  });
});
