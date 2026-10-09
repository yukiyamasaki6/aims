import { describe, expect, it } from "vitest";
import {
  buildShotOperation,
  clearHistoryEntry,
  discardDistanceEntries,
  firstOpenEnd,
  type HistoryEntry,
  isSamePointer,
  newShotPointer,
  type Pointer,
  pointerAfterScore,
  pushHistory,
  reconcilePointer,
  redoHistory,
  replayHistoryEntry,
  scoreHistoryEntry,
  shotPointer,
  undoHistory,
  withPendingShots,
} from "./scorecard-input";
import type { Distance, Shot } from "./scorecard-types";

function distance(
  id: string,
  positionKey: string,
  totalEnds: number,
  arrowsPerEnd: number,
): Distance {
  return {
    id,
    position_key: positionKey,
    distance: 30,
    total_ends: totalEnds,
    arrows_per_end: arrowsPerEnd,
    target_face_id: "face-1",
    is_marked: true,
  };
}

// 3エンド×2本の距離と、1エンド×2本の距離。
const distanceA = distance("d-a", "a", 3, 2);
const distanceB = distance("d-b", "b", 1, 2);
const distances = [distanceA, distanceB];

function shot(
  id: string,
  distanceId: string,
  end: number,
  scoreStr = "10",
  scoreInt = 10,
): Shot {
  return {
    id,
    distance_id: distanceId,
    end_number: end,
    score_str: scoreStr,
    score_int: scoreInt,
    shot_number: null,
  };
}

// エンドを満たす2本の矢。
function fill(distanceId: string, end: number): Shot[] {
  return [
    shot(`${distanceId}-${end}-1`, distanceId, end),
    shot(`${distanceId}-${end}-2`, distanceId, end),
  ];
}

// 指している矢を「new:距離/エンド」「shot:ID」の文字列で表し、期待値をリテラルで書けるようにする。
function describePointer(pointer: Pointer): string | null {
  if (pointer === null) return null;
  return pointer.kind === "new"
    ? `new:${pointer.distanceId}/${pointer.endNumber}`
    : `shot:${pointer.shotId}`;
}

const score = { scoreStr: "9", scoreInt: 9 };

describe("firstOpenEnd", () => {
  it("矢が無ければ、最初の距離のエンド1の新しい矢を指す", () => {
    expect(describePointer(firstOpenEnd(distances, []))).toBe("new:d-a/1");
  });

  it("矢数に達していない最初のエンドを、後ろのエンドに矢があっても指す", () => {
    // Given: エンド1が満杯、エンド2が1本、エンド3が満杯
    const shots = [...fill("d-a", 1), shot("x", "d-a", 2), ...fill("d-a", 3)];

    // When/Then
    expect(describePointer(firstOpenEnd(distances, shots))).toBe("new:d-a/2");
  });

  it("最初の距離が全て満杯なら次の距離、全て満杯ならnull", () => {
    const allA = [...fill("d-a", 1), ...fill("d-a", 2), ...fill("d-a", 3)];
    expect(describePointer(firstOpenEnd(distances, allA))).toBe("new:d-b/1");
    expect(firstOpenEnd(distances, [...allA, ...fill("d-b", 1)])).toBeNull();
  });
});

describe("pointerAfterScore", () => {
  it("記録済みの矢を指しているなら、そのまま指す", () => {
    const pointed = shotPointer(shot("s", "d-a", 1));
    expect(pointerAfterScore(distances, [], pointed)).toBe(pointed);
  });

  it("新しい矢のエンドに空きがあれば、同じエンドの新しい矢を指す", () => {
    const shots = [shot("x", "d-a", 1)];
    expect(
      describePointer(
        pointerAfterScore(distances, shots, newShotPointer("d-a", 1)),
      ),
    ).toBe("new:d-a/1");
  });

  it("満杯なら同じ距離で後ろの空きのあるエンドを指し、満杯のエンドは飛ばす", () => {
    // Given: エンド1と2が満杯
    const shots = [...fill("d-a", 1), ...fill("d-a", 2)];

    // When/Then
    expect(
      describePointer(
        pointerAfterScore(distances, shots, newShotPointer("d-a", 1)),
      ),
    ).toBe("new:d-a/3");
  });

  it("同じ距離の後ろに空きが無ければ、前のエンドや次の距離に空きがあっても何も指さない", () => {
    // Given: エンド3だけが満杯で、エンド1と次の距離に空きがある
    const shots = fill("d-a", 3);

    // When/Then
    expect(
      pointerAfterScore(distances, shots, newShotPointer("d-a", 3)),
    ).toBeNull();
  });

  it("距離が無ければ何も指さない", () => {
    expect(
      pointerAfterScore(distances, [], newShotPointer("none", 1)),
    ).toBeNull();
  });
});

describe("reconcilePointer", () => {
  it("何も指していなければ、そのまま", () => {
    expect(reconcilePointer(distances, [], null)).toBeNull();
  });

  it("生きている記録済みの矢と、空きのあるエンドの新しい矢は、そのまま指す", () => {
    const s = shot("s", "d-a", 1);
    const pointed = shotPointer(s);
    const fresh = newShotPointer("d-a", 2);
    expect(reconcilePointer(distances, [s], pointed)).toBe(pointed);
    expect(reconcilePointer(distances, [s], fresh)).toBe(fresh);
  });

  it("指している記録済みの矢が消えたら、そのエンドの新しい矢を指す", () => {
    const pointed = shotPointer(shot("s", "d-a", 2));
    expect(describePointer(reconcilePointer(distances, [], pointed))).toBe(
      "new:d-a/2",
    );
  });

  it("新しい矢のエンドが満杯になったら、点数を書いた後と同じ規則で進む", () => {
    expect(
      describePointer(
        reconcilePointer(distances, fill("d-a", 1), newShotPointer("d-a", 1)),
      ),
    ).toBe("new:d-a/2");
  });

  it("距離が無い、またはエンドが範囲外になったら何も指さない", () => {
    expect(
      reconcilePointer(distances, [], newShotPointer("none", 1)),
    ).toBeNull();
    // エンド数3の境界: 3は指し、4は指さない
    expect(
      describePointer(
        reconcilePointer(distances, [], newShotPointer("d-a", 3)),
      ),
    ).toBe("new:d-a/3");
    expect(
      reconcilePointer(distances, [], newShotPointer("d-a", 4)),
    ).toBeNull();
  });
});

describe("isSamePointer", () => {
  it("記録済みの矢はIDで、新しい矢は距離とエンドで比べる", () => {
    const a = shot("s", "d-a", 1);
    expect(isSamePointer(shotPointer(a), shotPointer({ ...a }))).toBe(true);
    expect(
      isSamePointer(shotPointer(a), shotPointer(shot("t", "d-a", 1))),
    ).toBe(false);
    expect(
      isSamePointer(newShotPointer("d-a", 1), newShotPointer("d-a", 1)),
    ).toBe(true);
    expect(
      isSamePointer(newShotPointer("d-a", 1), newShotPointer("d-a", 2)),
    ).toBe(false);
    expect(isSamePointer(newShotPointer("d-a", 1), shotPointer(a))).toBe(false);
    expect(isSamePointer(null, null)).toBe(true);
    expect(isSamePointer(null, newShotPointer("d-a", 1))).toBe(false);
  });
});

describe("取り消しの列の1件", () => {
  it("新しい矢へ書くと、渡したIDの矢が無い状態から点数を持つ状態への1件になる", () => {
    const entry = scoreHistoryEntry(
      [],
      newShotPointer("d-a", 2) as NonNullable<Pointer>,
      score,
      "new-id",
    );
    expect(entry).toEqual({
      shotId: "new-id",
      distanceId: "d-a",
      endNumber: 2,
      before: { alive: false },
      after: { alive: true, scoreStr: "9", scoreInt: 9 },
    });
  });

  it("記録済みの矢へ書くと、その矢の前の点数から新しい点数への1件になる", () => {
    const s = shot("s", "d-a", 1, "X", 10);
    const entry = scoreHistoryEntry(
      [s],
      shotPointer(s) as NonNullable<Pointer>,
      score,
      "unused",
    );
    expect(entry).toEqual({
      shotId: "s",
      distanceId: "d-a",
      endNumber: 1,
      before: { alive: true, scoreStr: "X", scoreInt: 10 },
      after: { alive: true, scoreStr: "9", scoreInt: 9 },
    });
  });

  it("クリアは、前の点数を持つ状態から消えた状態への1件になる", () => {
    expect(clearHistoryEntry(shot("s", "d-a", 1, "X", 10))).toEqual({
      shotId: "s",
      distanceId: "d-a",
      endNumber: 1,
      before: { alive: true, scoreStr: "X", scoreInt: 10 },
      after: { alive: false },
    });
  });
});

describe("取り消しの列", () => {
  const e = (shotId: string, distanceId = "d-a"): HistoryEntry => ({
    shotId,
    distanceId,
    endNumber: 1,
    before: { alive: false },
    after: { alive: true, scoreStr: "9", scoreInt: 9 },
  });

  it("新たな書き込みを積むと、やり直しの列を捨てる", () => {
    const history = pushHistory(
      { undoStack: [e("a")], redoStack: [e("b")] },
      e("c"),
    );
    expect(history).toEqual({ undoStack: [e("a"), e("c")], redoStack: [] });
  });

  it("戻ると直近の1件をやり直しの列へ移し、進むと取り消しの列へ戻す", () => {
    const undone = undoHistory({ undoStack: [e("a"), e("b")], redoStack: [] });
    expect(undone).toEqual({
      entry: e("b"),
      history: { undoStack: [e("a")], redoStack: [e("b")] },
    });
    const redone = redoHistory(
      undone?.history ?? { undoStack: [], redoStack: [] },
    );
    expect(redone).toEqual({
      entry: e("b"),
      history: { undoStack: [e("a"), e("b")], redoStack: [] },
    });
  });

  it("列が空なら、戻る・進むはnull", () => {
    const empty = { undoStack: [], redoStack: [] };
    expect(undoHistory(empty)).toBeNull();
    expect(redoHistory(empty)).toBeNull();
  });

  it("距離の構成の変更・削除では、その距離の書き込みだけを捨てる", () => {
    expect(
      discardDistanceEntries([e("a"), e("b", "d-b"), e("c")], "d-a"),
    ).toEqual([e("b", "d-b")]);
  });
});

describe("buildShotOperation", () => {
  const target = { shotId: "s", distanceId: "d-a", endNumber: 2 };

  it("生きている状態は、射手・射順を持たない記録にする", () => {
    expect(
      buildShotOperation(target, { alive: true, ...score }, "e-1"),
    ).toEqual({
      type: "shot.recorded",
      eventId: "e-1",
      shotId: "s",
      distanceId: "d-a",
      endNumber: 2,
      scoreStr: "9",
      scoreInt: 9,
    });
  });

  it("消えた状態は、クリアにする", () => {
    expect(buildShotOperation(target, { alive: false }, "e-1")).toEqual({
      type: "shot.cleared",
      eventId: "e-1",
      shotId: "s",
      distanceId: "d-a",
      endNumber: 2,
    });
  });
});

describe("replayHistoryEntry", () => {
  const entry: HistoryEntry = {
    shotId: "s",
    distanceId: "d-a",
    endNumber: 1,
    before: { alive: false },
    after: { alive: true, ...score },
  };

  it("矢を生きている状態にするときは、記録を積み、その矢を指す", () => {
    const result = replayHistoryEntry(distances, [], entry, entry.after, "e-1");
    expect(result?.operation).toMatchObject({
      type: "shot.recorded",
      shotId: "s",
    });
    expect(describePointer(result?.pointer ?? null)).toBe("shot:s");
  });

  it("矢を消えた状態にするときは、クリアを積み、そのエンドの新しい矢を指す", () => {
    const result = replayHistoryEntry(
      distances,
      [shot("s", "d-a", 1)],
      entry,
      entry.before,
      "e-1",
    );
    expect(result?.operation).toMatchObject({
      type: "shot.cleared",
      shotId: "s",
    });
    expect(describePointer(result?.pointer ?? null)).toBe("new:d-a/1");
  });

  it("復活がエンドに入らないときはnullを返す。生きている矢の点数を変えるときは満杯でも積む", () => {
    // Given: エンド1が他の矢で満杯
    const full = fill("d-a", 1);

    // When/Then
    expect(
      replayHistoryEntry(distances, full, entry, entry.after, "e-1"),
    ).toBeNull();
    const live = [shot("s", "d-a", 1), shot("t", "d-a", 1)];
    expect(
      replayHistoryEntry(distances, live, entry, entry.after, "e-1"),
    ).not.toBeNull();
  });

  it("距離が無ければnullを返す", () => {
    expect(
      replayHistoryEntry(
        distances,
        [],
        { ...entry, distanceId: "none" },
        entry.after,
        "e-1",
      ),
    ).toBeNull();
  });
});

describe("withPendingShots", () => {
  it("画面へまだ反映されていない記録とクリアを、生きている矢に重ねる", () => {
    // Given: 矢aがあり、新しい矢bの記録、aの点数の変更、新しい矢cの記録とクリアが未反映
    const shots = [{ ...shot("a", "d-a", 1), shooter_id: "u-1" }];

    // When
    const result = withPendingShots(shots, [
      buildShotOperation(
        { shotId: "b", distanceId: "d-a", endNumber: 1 },
        { alive: true, ...score },
        "e-1",
      ),
      buildShotOperation(
        { shotId: "a", distanceId: "d-a", endNumber: 1 },
        { alive: true, scoreStr: "M", scoreInt: 0 },
        "e-2",
      ),
      buildShotOperation(
        { shotId: "c", distanceId: "d-a", endNumber: 2 },
        { alive: true, ...score },
        "e-3",
      ),
      buildShotOperation(
        { shotId: "c", distanceId: "d-a", endNumber: 2 },
        { alive: false },
        "e-4",
      ),
      { type: "round.updated", eventId: "e-5", roundId: "r", changes: {} },
    ]);

    // Then: aは射手を保ったまま点数が変わり、bが足され、cは残らない
    expect(result).toEqual([
      { ...shot("a", "d-a", 1, "M", 0), shooter_id: "u-1" },
      shot("b", "d-a", 1, "9", 9),
    ]);
  });
});
