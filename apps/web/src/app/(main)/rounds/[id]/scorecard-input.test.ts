import { describe, expect, it } from "vitest";
import type { Distance, Shot } from "@/features/rounds/scorecard-types";
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

// 12エンド×3本の距離が2つ。
const distanceA = distance("d-a", "a", 12, 3);
const distanceB = distance("d-b", "b", 12, 3);
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

// エンドを満たす3本の矢。
function fill(distanceId: string, end: number): Shot[] {
  return [
    shot(`${distanceId}-${end}-1`, distanceId, end),
    shot(`${distanceId}-${end}-2`, distanceId, end),
    shot(`${distanceId}-${end}-3`, distanceId, end),
  ];
}

// 距離の全てのエンドを満たす矢。
function fillAll(distanceId: string): Shot[] {
  return Array.from({ length: 12 }, (_, i) => fill(distanceId, i + 1)).flat();
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
    // Given

    // When
    const result = firstOpenEnd(distances, []);

    // Then
    expect(describePointer(result)).toBe("new:d-a/1");
  });

  it("矢数に達していない最初のエンドを、後ろのエンドに矢があっても指す", () => {
    // Given

    // When
    const shots = [...fill("d-a", 1), shot("x", "d-a", 2), ...fill("d-a", 3)];
    const result = firstOpenEnd(distances, shots);

    // Then
    expect(describePointer(result)).toBe("new:d-a/2");
  });

  it("最初の距離が全て満杯なら、次の距離のエンド1の新しい矢を指す", () => {
    // Given

    // When
    const allA = fillAll("d-a");
    const result = firstOpenEnd(distances, allA);

    // Then
    expect(describePointer(result)).toBe("new:d-b/1");
  });

  it("全ての距離が満杯なら、何も指さない", () => {
    // Given

    // When
    const result = firstOpenEnd(distances, [
      ...fillAll("d-a"),
      ...fillAll("d-b"),
    ]);

    // Then
    expect(result).toBeNull();
  });
});

describe("pointerAfterScore", () => {
  it("記録済みの矢を指しているなら、そのまま指す", () => {
    // Given

    // When
    const pointed = shotPointer(shot("s", "d-a", 1));
    const result = pointerAfterScore(distances, [], pointed);

    // Then
    expect(result).toBe(pointed);
  });

  it("新しい矢のエンドに空きがあれば、同じエンドの新しい矢を指す", () => {
    // Given

    // When
    const shots = [shot("x", "d-a", 1)];
    const result = pointerAfterScore(
      distances,
      shots,
      newShotPointer("d-a", 1),
    );

    // Then
    expect(describePointer(result)).toBe("new:d-a/1");
  });

  it("満杯なら同じ距離で後ろの空きのあるエンドを指し、満杯のエンドは飛ばす", () => {
    // Given

    // When
    const shots = [...fill("d-a", 1), ...fill("d-a", 2)];
    const result = pointerAfterScore(
      distances,
      shots,
      newShotPointer("d-a", 1),
    );

    // Then
    expect(describePointer(result)).toBe("new:d-a/3");
  });

  it("同じ距離の後ろに空きが無ければ、前のエンドや次の距離に空きがあっても何も指さない", () => {
    // Given

    // When
    const shots = fill("d-a", 12);
    const result = pointerAfterScore(
      distances,
      shots,
      newShotPointer("d-a", 12),
    );

    // Then
    expect(result).toBeNull();
  });

  it("距離が無ければ何も指さない", () => {
    // Given

    // When
    const result = pointerAfterScore(distances, [], newShotPointer("none", 1));

    // Then
    expect(result).toBeNull();
  });
});

describe("reconcilePointer", () => {
  it("何も指していなければ、そのまま", () => {
    // Given

    // When
    const result = reconcilePointer(distances, [], null);

    // Then
    expect(result).toBeNull();
  });

  it("生きている記録済みの矢は、そのまま指す", () => {
    // Given

    // When
    const s = shot("s", "d-a", 1);
    const pointed = shotPointer(s);
    const result = reconcilePointer(distances, [s], pointed);

    // Then
    expect(result).toBe(pointed);
  });

  it("空きのあるエンドの新しい矢は、そのまま指す", () => {
    // Given

    // When
    const s = shot("s", "d-a", 1);
    const fresh = newShotPointer("d-a", 2);
    const result = reconcilePointer(distances, [s], fresh);

    // Then
    expect(result).toBe(fresh);
  });

  it("指している記録済みの矢が消えたら、そのエンドの新しい矢を指す", () => {
    // Given

    // When
    const pointed = shotPointer(shot("s", "d-a", 2));
    const result = reconcilePointer(distances, [], pointed);

    // Then
    expect(describePointer(result)).toBe("new:d-a/2");
  });

  it("新しい矢のエンドが満杯になったら、点数を書いた後と同じ規則で進む", () => {
    // Given

    // When
    const result = reconcilePointer(
      distances,
      fill("d-a", 1),
      newShotPointer("d-a", 1),
    );

    // Then
    expect(describePointer(result)).toBe("new:d-a/2");
  });

  it("距離が無ければ何も指さない", () => {
    // Given

    // When
    const result = reconcilePointer(distances, [], newShotPointer("none", 1));

    // Then
    expect(result).toBeNull();
  });

  it("エンドが範囲外になったら何も指さず、最後のエンドは指したままにする", () => {
    // Given

    // When
    const last = reconcilePointer(distances, [], newShotPointer("d-a", 12));
    const beyond = reconcilePointer(distances, [], newShotPointer("d-a", 13));

    // Then
    expect(describePointer(last)).toBe("new:d-a/12");
    expect(beyond).toBeNull();
  });
});

describe("isSamePointer", () => {
  it("記録済みの矢どうしは、IDで比べる", () => {
    // Given

    // When
    const a = shot("s", "d-a", 1);
    const sameId = isSamePointer(shotPointer(a), shotPointer({ ...a }));
    const otherId = isSamePointer(
      shotPointer(a),
      shotPointer(shot("t", "d-a", 1)),
    );

    // Then
    expect(sameId).toBe(true);
    expect(otherId).toBe(false);
  });

  it("新しい矢どうしは、距離とエンドで比べる", () => {
    // Given

    // When
    const sameEnd = isSamePointer(
      newShotPointer("d-a", 1),
      newShotPointer("d-a", 1),
    );
    const otherEnd = isSamePointer(
      newShotPointer("d-a", 1),
      newShotPointer("d-a", 2),
    );

    // Then
    expect(sameEnd).toBe(true);
    expect(otherEnd).toBe(false);
  });

  it("記録済みの矢と新しい矢は、同じとみなさない", () => {
    // Given

    // When
    const a = shot("s", "d-a", 1);
    const result = isSamePointer(newShotPointer("d-a", 1), shotPointer(a));

    // Then
    expect(result).toBe(false);
  });

  it("何も指していないものどうしは同じで、指しているものとは違う", () => {
    // Given

    // When
    const bothNone = isSamePointer(null, null);
    const noneAndNew = isSamePointer(null, newShotPointer("d-a", 1));

    // Then
    expect(bothNone).toBe(true);
    expect(noneAndNew).toBe(false);
  });
});

describe("取り消しの列の1件", () => {
  it("新しい矢へ書くと、渡したIDの矢が無い状態から点数を持つ状態への1件になる", () => {
    // Given

    // When
    const entry = scoreHistoryEntry(
      [],
      newShotPointer("d-a", 2) as NonNullable<Pointer>,
      score,
      "new-id",
    );

    // Then
    expect(entry).toEqual({
      shotId: "new-id",
      distanceId: "d-a",
      endNumber: 2,
      before: { alive: false },
      after: { alive: true, scoreStr: "9", scoreInt: 9 },
    });
  });

  it("記録済みの矢へ書くと、その矢の前の点数から新しい点数への1件になる", () => {
    // Given

    // When
    const s = shot("s", "d-a", 1, "X", 10);
    const entry = scoreHistoryEntry(
      [s],
      shotPointer(s) as NonNullable<Pointer>,
      score,
      "unused",
    );

    // Then
    expect(entry).toEqual({
      shotId: "s",
      distanceId: "d-a",
      endNumber: 1,
      before: { alive: true, scoreStr: "X", scoreInt: 10 },
      after: { alive: true, scoreStr: "9", scoreInt: 9 },
    });
  });

  it("クリアは、前の点数を持つ状態から消えた状態への1件になる", () => {
    // Given

    // When
    const entry = clearHistoryEntry(shot("s", "d-a", 1, "X", 10));

    // Then
    expect(entry).toEqual({
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
    // Given

    // When
    const history = pushHistory(
      { undoStack: [e("a")], redoStack: [e("b")] },
      e("c"),
    );

    // Then
    expect(history).toEqual({ undoStack: [e("a"), e("c")], redoStack: [] });
  });

  it("戻ると、直近の1件をやり直しの列へ移す", () => {
    // Given

    // When
    const undone = undoHistory({ undoStack: [e("a"), e("b")], redoStack: [] });

    // Then
    expect(undone).toEqual({
      entry: e("b"),
      history: { undoStack: [e("a")], redoStack: [e("b")] },
    });
  });

  it("進むと、やり直しの列の1件を取り消しの列へ戻す", () => {
    // Given

    // When
    const redone = redoHistory({ undoStack: [e("a")], redoStack: [e("b")] });

    // Then
    expect(redone).toEqual({
      entry: e("b"),
      history: { undoStack: [e("a"), e("b")], redoStack: [] },
    });
  });

  it("列が空なら、戻るはnull", () => {
    // Given

    // When
    const result = undoHistory({ undoStack: [], redoStack: [] });

    // Then
    expect(result).toBeNull();
  });

  it("列が空なら、進むはnull", () => {
    // Given

    // When
    const result = redoHistory({ undoStack: [], redoStack: [] });

    // Then
    expect(result).toBeNull();
  });

  it("距離の構成の変更・削除では、その距離の書き込みだけを捨てる", () => {
    // Given

    // When
    const result = discardDistanceEntries(
      [e("a"), e("b", "d-b"), e("c")],
      "d-a",
    );

    // Then
    expect(result).toEqual([e("b", "d-b")]);
  });
});

describe("buildShotOperation", () => {
  const target = { shotId: "s", distanceId: "d-a", endNumber: 2 };

  it("生きている状態は、射手・射順を持たない記録にする", () => {
    // Given

    // When
    const operation = buildShotOperation(
      target,
      { alive: true, ...score },
      "e-1",
    );

    // Then
    expect(operation).toEqual({
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
    // Given

    // When
    const operation = buildShotOperation(target, { alive: false }, "e-1");

    // Then
    expect(operation).toEqual({
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
    // Given

    // When
    const result = replayHistoryEntry(distances, [], entry, entry.after, "e-1");

    // Then
    expect(result?.operation).toMatchObject({
      type: "shot.recorded",
      shotId: "s",
    });
    expect(describePointer(result?.pointer ?? null)).toBe("shot:s");
  });

  it("矢を消えた状態にするときは、クリアを積み、そのエンドの新しい矢を指す", () => {
    // Given

    // When
    const result = replayHistoryEntry(
      distances,
      [shot("s", "d-a", 1)],
      entry,
      entry.before,
      "e-1",
    );

    // Then
    expect(result?.operation).toMatchObject({
      type: "shot.cleared",
      shotId: "s",
    });
    expect(describePointer(result?.pointer ?? null)).toBe("new:d-a/1");
  });

  it("復活する矢がエンドに入らないときは、nullを返す", () => {
    // Given

    // When
    const full = fill("d-a", 1);
    const result = replayHistoryEntry(
      distances,
      full,
      entry,
      entry.after,
      "e-1",
    );

    // Then
    expect(result).toBeNull();
  });

  it("生きている矢の点数を変えるときは、エンドが満杯でも積む", () => {
    // Given

    // When
    const live = [
      shot("s", "d-a", 1),
      shot("t", "d-a", 1),
      shot("u", "d-a", 1),
    ];
    const result = replayHistoryEntry(
      distances,
      live,
      entry,
      entry.after,
      "e-1",
    );

    // Then
    expect(result).not.toBeNull();
  });

  it("距離が無ければnullを返す", () => {
    // Given

    // When
    const result = replayHistoryEntry(
      distances,
      [],
      { ...entry, distanceId: "none" },
      entry.after,
      "e-1",
    );

    // Then
    expect(result).toBeNull();
  });
});

describe("withPendingShots", () => {
  it("画面へまだ反映されていない記録とクリアを、生きている矢に重ねる", () => {
    // Given

    // When
    const shots = [{ ...shot("a", "d-a", 1), shooter_id: "u-1" }];
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

    // Then
    expect(result).toEqual([
      { ...shot("a", "d-a", 1, "M", 0), shooter_id: "u-1" },
      shot("b", "d-a", 1, "9", 9),
    ]);
  });
});
