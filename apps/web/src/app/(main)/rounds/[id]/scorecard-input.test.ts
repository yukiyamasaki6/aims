import { describe, expect, it } from "vitest";
import {
  type Cell,
  cellLabel,
  cellOf,
  clearHistoryEntry,
  findCurrentPosition,
  type HistoryEntry,
  type Position,
  positionAfterClear,
  positionAfterScore,
  positionAfterSelect,
  positionOfCell,
  pushHistory,
  redoHistory,
  replaceShot,
  scoreHistoryEntry,
  shotEnqueueInput,
  undoHistory,
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

// 2エンド×2本の距離と、1エンド×2本の距離。
const distanceA = distance("d-a", "a", 2, 2);
const distanceB = distance("d-b", "b", 1, 2);
const distances = [distanceA, distanceB];

function at(d: Distance, end: number, arrow: number): Position {
  return { distance: d, end, arrow };
}

// 位置を「距離ID/エンド/本目」の文字列で表し、期待値をリテラルで書けるようにする。
function describePosition(position: Position | null): string | null {
  return position
    ? `${position.distance.id}/${position.end}/${position.arrow}`
    : null;
}

function shot(
  distanceId: string,
  end: number,
  arrow: number,
  scoreStr: string,
  scoreInt: number,
  shooterId?: string,
): Shot {
  return {
    distance_id: distanceId,
    end_number: end,
    arrow_number: arrow,
    shooter_id: shooterId,
    score_str: scoreStr,
    score_int: scoreInt,
  };
}

function entry(
  distanceId: string,
  end: number,
  arrow: number,
  prevShot: Shot | null,
  nextShot: Shot | null,
): HistoryEntry {
  return {
    distanceId,
    endNumber: end,
    arrowNumber: arrow,
    prevShot,
    nextShot,
  };
}

describe("findCurrentPosition", () => {
  it("記録が無い場合、最初の距離の最初のマスを返す", () => {
    // Given: 記録が無い
    // When: 最初の未記録のマスを探す
    const position = findCurrentPosition(distances, []);

    // Then: 最初のマス
    expect(describePosition(position)).toBe("d-a/1/1");
  });

  it("途中のマスが未記録の場合、それより後に記録があってもそのマスを返す", () => {
    // Given: 1-1と2-1が記録済みで、1-2が未記録
    const shots = [shot("d-a", 1, 1, "10", 10), shot("d-a", 2, 1, "9", 9)];

    // When: 最初の未記録のマスを探す
    const position = findCurrentPosition(distances, shots);

    // Then: 1-2
    expect(describePosition(position)).toBe("d-a/1/2");
  });

  it("最初の距離が全て記録済みの場合、次の距離の最初のマスを返す", () => {
    // Given: 最初の距離の全マスが記録済み
    const shots = [
      shot("d-a", 1, 1, "10", 10),
      shot("d-a", 1, 2, "10", 10),
      shot("d-a", 2, 1, "10", 10),
      shot("d-a", 2, 2, "10", 10),
    ];

    // When: 最初の未記録のマスを探す
    const position = findCurrentPosition(distances, shots);

    // Then: 次の距離の最初のマス
    expect(describePosition(position)).toBe("d-b/1/1");
  });

  it("全てのマスが記録済みの場合、nullを返す", () => {
    // Given: 全てのマスが記録済み
    const shots = [
      shot("d-a", 1, 1, "10", 10),
      shot("d-a", 1, 2, "10", 10),
      shot("d-a", 2, 1, "10", 10),
      shot("d-a", 2, 2, "10", 10),
      shot("d-b", 1, 1, "10", 10),
      shot("d-b", 1, 2, "10", 10),
    ];

    // When: 最初の未記録のマスを探す
    const position = findCurrentPosition(distances, shots);

    // Then: 未記録のマスは無い
    expect(position).toBeNull();
  });

  it("距離が無い場合、nullを返す", () => {
    // Given: 距離が無い
    // When: 最初の未記録のマスを探す
    const position = findCurrentPosition([], []);

    // Then: マスは無い
    expect(position).toBeNull();
  });
});

describe("positionAfterScore", () => {
  it("距離の最後のマス以外では、同じエンドの次の本目か次のエンドの最初の本目へ進む", () => {
    // Given: エンドの途中のマス、最終エンドではないエンドの最後のマス、最終エンドの最後の1つ前のマス
    // When: 記録する
    // Then: それぞれ次のマスへ進む
    expect(
      describePosition(positionAfterScore(distances, at(distanceA, 1, 1))),
    ).toBe("d-a/1/2");
    expect(
      describePosition(positionAfterScore(distances, at(distanceA, 1, 2))),
    ).toBe("d-a/2/1");
    expect(
      describePosition(positionAfterScore(distances, at(distanceA, 2, 1))),
    ).toBe("d-a/2/2");
  });

  it("距離の最後のマスでは、次の距離へ進まず選択を解除する", () => {
    // Given: 次の距離がある距離の最後のマスと、最後の距離の最後のマス
    // When: 記録する
    // Then: どちらも選択を解除する
    expect(positionAfterScore(distances, at(distanceA, 2, 2))).toBeNull();
    expect(positionAfterScore(distances, at(distanceB, 1, 2))).toBeNull();
  });

  it("選択中のマスが距離構成に無い場合、選択を解除する", () => {
    // Given: 距離構成に無い距離のマスと、現在の構成より多いエンド数を持つ古い距離の、現在の構成では最後にあたるマス
    const removed = distance("d-removed", "c", 2, 2);
    const staleB = distance("d-b", "b", 2, 2);

    // When: 記録する
    // Then: どちらも移動先が無く、選択を解除する
    expect(positionAfterScore(distances, at(removed, 1, 1))).toBeNull();
    expect(positionAfterScore(distances, at(staleB, 1, 2))).toBeNull();
  });
});

describe("positionAfterClear", () => {
  it("距離の最初のマス以外では、同じエンドの前の本目か前のエンドの最後の本目へ戻る", () => {
    // Given: エンドの途中のマスと、2エンド目の最初のマス
    // When: クリアする
    // Then: それぞれ前のマスへ戻る
    expect(
      describePosition(positionAfterClear(distances, at(distanceA, 1, 2))),
    ).toBe("d-a/1/1");
    expect(
      describePosition(positionAfterClear(distances, at(distanceA, 2, 1))),
    ).toBe("d-a/1/2");
  });

  it("距離の最初のマスでは、前の距離へ戻らずそのマスに留まる", () => {
    // Given: 前の距離がある距離の最初のマスと、最初の距離の最初のマス
    // When: クリアする
    // Then: どちらもそのマスに留まる
    expect(
      describePosition(positionAfterClear(distances, at(distanceB, 1, 1))),
    ).toBe("d-b/1/1");
    expect(
      describePosition(positionAfterClear(distances, at(distanceA, 1, 1))),
    ).toBe("d-a/1/1");
  });

  it("距離構成に無いマスでは、そのマスに留まる", () => {
    // Given: 距離構成に無い距離の、最初ではないマス
    const removed = distance("d-removed", "c", 1, 2);

    // When: クリアする
    const position = positionAfterClear(distances, at(removed, 1, 2));

    // Then: そのマスに留まる
    expect(describePosition(position)).toBe("d-removed/1/2");
  });
});

describe("positionAfterSelect", () => {
  it("選択中のマスと別のマスを選ぶと、そのマスを選択する", () => {
    // Given: 同じ距離・エンドで本目だけが異なるマス、同じ位置で距離だけが異なるマスを選択中
    // When: マスを選ぶ
    // Then: 選んだマスを選択する
    expect(
      describePosition(
        positionAfterSelect(at(distanceA, 1, 1), at(distanceA, 1, 2)),
      ),
    ).toBe("d-a/1/2");
    expect(
      describePosition(
        positionAfterSelect(at(distanceA, 1, 2), at(distanceA, 2, 2)),
      ),
    ).toBe("d-a/2/2");
    expect(
      describePosition(
        positionAfterSelect(at(distanceA, 1, 1), at(distanceB, 1, 1)),
      ),
    ).toBe("d-b/1/1");
  });

  it("選択中のマスが無い場合、選んだマスを選択する", () => {
    // Given: 選択中のマスが無い
    // When: マスを選ぶ
    const position = positionAfterSelect(null, at(distanceA, 2, 1));

    // Then: 選んだマスを選択する
    expect(describePosition(position)).toBe("d-a/2/1");
  });

  it("選択中のマスを再度選ぶと、選択を解除する", () => {
    // Given: マスを選択中
    // When: 同じマスを選ぶ
    const position = positionAfterSelect(
      at(distanceA, 1, 2),
      at(distanceA, 1, 2),
    );

    // Then: 選択を解除する
    expect(position).toBeNull();
  });
});

describe("positionOfCell", () => {
  it("距離構成にある距離のマスを、その距離のマスとして返す", () => {
    // Given: 距離構成にある距離のマス
    const cell: Cell = { distanceId: "d-b", endNumber: 1, arrowNumber: 2 };

    // When: マスを引く
    const position = positionOfCell(distances, cell);

    // Then: その距離のマス
    expect(position).toEqual(at(distanceB, 1, 2));
  });

  it("距離構成に無い距離のマスでは、nullを返す", () => {
    // Given: 距離構成に無い距離のマス
    const cell: Cell = {
      distanceId: "d-removed",
      endNumber: 1,
      arrowNumber: 1,
    };

    // When: マスを引く
    const position = positionOfCell(distances, cell);

    // Then: マスは無い
    expect(position).toBeNull();
  });
});

describe("cellOf", () => {
  it("選択中のマスを、距離IDで指すマスに変換する", () => {
    // Given: 選択中のマス
    // When: 変換する
    const cell = cellOf(at(distanceB, 1, 2));

    // Then: 距離ID・エンド・本目で指す
    expect(cell).toEqual({ distanceId: "d-b", endNumber: 1, arrowNumber: 2 });
  });
});

describe("replaceShot", () => {
  const cell: Cell = { distanceId: "d-a", endNumber: 1, arrowNumber: 2 };

  describe("記録で置き換える", () => {
    it("マスに記録が無い場合、記録を追加する", () => {
      // Given: 別のマスの記録だけがある
      const shots = [shot("d-a", 1, 1, "10", 10)];

      // When: マスの記録を置き換える
      const replaced = replaceShot(shots, cell, shot("d-a", 1, 2, "9", 9));

      // Then: 別のマスの記録を残して追加する
      expect(replaced).toEqual([
        shot("d-a", 1, 1, "10", 10),
        shot("d-a", 1, 2, "9", 9),
      ]);
    });

    it("マスに記録がある場合、その記録だけを置き換える", () => {
      // Given: マスの記録と別のマスの記録がある
      const shots = [shot("d-a", 1, 2, "9", 9), shot("d-b", 1, 2, "8", 8)];

      // When: マスの記録を置き換える
      const replaced = replaceShot(shots, cell, shot("d-a", 1, 2, "X", 10));

      // Then: 同じマスの記録だけが置き換わる
      expect(replaced).toEqual([
        shot("d-b", 1, 2, "8", 8),
        shot("d-a", 1, 2, "X", 10),
      ]);
    });
  });

  describe("記録を取り除く", () => {
    it("マスに記録がある場合、その記録だけを取り除く", () => {
      // Given: マスの記録と別のマスの記録がある
      const shots = [shot("d-a", 1, 2, "9", 9), shot("d-a", 2, 2, "8", 8)];

      // When: マスの記録を取り除く
      const replaced = replaceShot(shots, cell, null);

      // Then: 別のマスの記録だけが残る
      expect(replaced).toEqual([shot("d-a", 2, 2, "8", 8)]);
    });

    it("マスに記録が無い場合、記録は変わらない", () => {
      // Given: 別のマスの記録だけがある
      const shots = [shot("d-a", 2, 2, "8", 8)];

      // When: マスの記録を取り除く
      const replaced = replaceShot(shots, cell, null);

      // Then: 記録は変わらない
      expect(replaced).toEqual([shot("d-a", 2, 2, "8", 8)]);
    });
  });
});

describe("scoreHistoryEntry", () => {
  it("未記録のマスに記録すると、未記録から記録への遷移になる", () => {
    // Given: 別のマスの記録だけがある
    const shots = [shot("d-a", 1, 1, "10", 10, "shooter-1")];

    // When: 未記録のマスに記録する
    const result = scoreHistoryEntry(shots, at(distanceA, 1, 2), "9", 9);

    // Then: 射手を持たない記録への遷移になる
    expect(result).toEqual({
      distanceId: "d-a",
      endNumber: 1,
      arrowNumber: 2,
      prevShot: null,
      nextShot: {
        distance_id: "d-a",
        end_number: 1,
        arrow_number: 2,
        shooter_id: undefined,
        score_str: "9",
        score_int: 9,
      },
    });
  });

  it("記録済みのマスに上書きすると、元の記録の射手を引き継ぐ", () => {
    // Given: マスに射手付きの記録がある
    const shots = [shot("d-a", 1, 2, "9", 9, "shooter-1")];

    // When: 上書きする
    const result = scoreHistoryEntry(shots, at(distanceA, 1, 2), "X", 10);

    // Then: 元の記録から、射手を引き継いだ新しい記録への遷移になる
    expect(result).toEqual({
      distanceId: "d-a",
      endNumber: 1,
      arrowNumber: 2,
      prevShot: {
        distance_id: "d-a",
        end_number: 1,
        arrow_number: 2,
        shooter_id: "shooter-1",
        score_str: "9",
        score_int: 9,
      },
      nextShot: {
        distance_id: "d-a",
        end_number: 1,
        arrow_number: 2,
        shooter_id: "shooter-1",
        score_str: "X",
        score_int: 10,
      },
    });
  });
});

describe("clearHistoryEntry", () => {
  it("記録済みのマスをクリアすると、記録から未記録への遷移になる", () => {
    // Given: マスに記録がある
    const shots = [shot("d-a", 2, 1, "8", 8, "shooter-1")];

    // When: クリアする
    const result = clearHistoryEntry(shots, at(distanceA, 2, 1));

    // Then: 記録から未記録への遷移になる
    expect(result).toEqual({
      distanceId: "d-a",
      endNumber: 2,
      arrowNumber: 1,
      prevShot: {
        distance_id: "d-a",
        end_number: 2,
        arrow_number: 1,
        shooter_id: "shooter-1",
        score_str: "8",
        score_int: 8,
      },
      nextShot: null,
    });
  });

  it("距離・エンド・本目のいずれかだけが異なる記録は、そのマスの記録とみなさない", () => {
    // Given: 距離だけ・エンドだけ・本目だけが2-1と異なる記録がある
    const shots = [
      shot("d-b", 2, 1, "10", 10),
      shot("d-a", 1, 1, "9", 9),
      shot("d-a", 2, 2, "8", 8),
    ];

    // When: 2-1をクリアする
    const result = clearHistoryEntry(shots, at(distanceA, 2, 1));

    // Then: 未記録のマスとして、履歴に残す遷移は無い
    expect(result).toBeNull();
  });

  it("未記録のマスをクリアしても、遷移は無い", () => {
    // Given: 別のマスの記録だけがある
    const shots = [shot("d-a", 1, 1, "10", 10)];

    // When: 未記録のマスをクリアする
    const result = clearHistoryEntry(shots, at(distanceA, 2, 1));

    // Then: 履歴に残す遷移は無い
    expect(result).toBeNull();
  });
});

describe("pushHistory", () => {
  const first = entry("d-a", 1, 1, null, shot("d-a", 1, 1, "10", 10));
  const second = entry("d-a", 1, 2, null, shot("d-a", 1, 2, "9", 9));
  const undone = entry("d-a", 2, 1, null, shot("d-a", 2, 1, "8", 8));

  it("遷移を取り消し履歴の末尾に積み、やり直し履歴を破棄する", () => {
    // Given: 取り消し履歴とやり直し履歴がある
    const history = { undoStack: [first], redoStack: [undone] };

    // When: 遷移を積む
    const result = pushHistory(history, second);

    // Then: 取り消し履歴の末尾に積まれ、やり直し履歴は空になる
    expect(result).toEqual({ undoStack: [first, second], redoStack: [] });
  });

  it("遷移が無い場合、履歴は変わらない", () => {
    // Given: 取り消し履歴とやり直し履歴がある
    const history = { undoStack: [first], redoStack: [undone] };

    // When: 遷移が無いまま積む
    const result = pushHistory(history, null);

    // Then: やり直し履歴も含めて変わらない
    expect(result).toEqual({ undoStack: [first], redoStack: [undone] });
  });
});

describe("undoHistory", () => {
  const first = entry("d-a", 1, 1, null, shot("d-a", 1, 1, "10", 10));
  const second = entry("d-a", 1, 2, null, shot("d-a", 1, 2, "9", 9));
  const undone = entry("d-a", 2, 1, null, shot("d-a", 2, 1, "8", 8));

  it("取り消し履歴の末尾の遷移を取り出し、やり直し履歴の末尾に移す", () => {
    // Given: 取り消し履歴とやり直し履歴がある
    const history = { undoStack: [first, second], redoStack: [undone] };

    // When: 取り消す
    const result = undoHistory(history);

    // Then: 直近の遷移がやり直し履歴の末尾へ移る
    expect(result).toEqual({
      entry: second,
      history: { undoStack: [first], redoStack: [undone, second] },
    });
  });

  it("取り消し履歴が空の場合、nullを返す", () => {
    // Given: 取り消し履歴が空
    const history = { undoStack: [], redoStack: [undone] };

    // When: 取り消す
    const result = undoHistory(history);

    // Then: 取り消す遷移は無い
    expect(result).toBeNull();
  });
});

describe("redoHistory", () => {
  const first = entry("d-a", 1, 1, null, shot("d-a", 1, 1, "10", 10));
  const undone1 = entry("d-a", 1, 2, null, shot("d-a", 1, 2, "9", 9));
  const undone2 = entry("d-a", 2, 1, null, shot("d-a", 2, 1, "8", 8));

  it("やり直し履歴の末尾の遷移を取り出し、取り消し履歴の末尾に戻す", () => {
    // Given: 取り消し履歴とやり直し履歴がある
    const history = { undoStack: [first], redoStack: [undone1, undone2] };

    // When: やり直す
    const result = redoHistory(history);

    // Then: 直近に取り消した遷移が取り消し履歴の末尾へ戻る
    expect(result).toEqual({
      entry: undone2,
      history: { undoStack: [first, undone2], redoStack: [undone1] },
    });
  });

  it("やり直し履歴が空の場合、nullを返す", () => {
    // Given: やり直し履歴が空
    const history = { undoStack: [first], redoStack: [] };

    // When: やり直す
    const result = redoHistory(history);

    // Then: やり直す遷移は無い
    expect(result).toBeNull();
  });
});

describe("cellLabel", () => {
  it("距離の番号・エンド・本目を示す", () => {
    // Given: 2番目の距離のマス
    const cell: Cell = { distanceId: "d-b", endNumber: 1, arrowNumber: 2 };

    // When: ラベルを作る
    const label = cellLabel(distances, cell);

    // Then: 距離の番号・エンド・本目を示す
    expect(label).toBe("距離2 1エンド2本目");
  });

  it("距離構成に無い距離のマスでは、距離の番号を?とする", () => {
    // Given: 距離構成に無い距離のマス
    const cell: Cell = {
      distanceId: "d-removed",
      endNumber: 3,
      arrowNumber: 4,
    };

    // When: ラベルを作る
    const label = cellLabel(distances, cell);

    // Then: 距離の番号を?とする
    expect(label).toBe("距離? 3エンド4本目");
  });
});

describe("shotEnqueueInput", () => {
  const cell: Cell = { distanceId: "d-a", endNumber: 2, arrowNumber: 1 };

  it("記録する場合、その距離の作成を待つ記録の操作にする", () => {
    // Given: 射手付きの記録
    // When: 送信キューへ積む入力に変換する
    const input = shotEnqueueInput({
      cell,
      shot: shot("d-a", 2, 1, "X", 10, "shooter-1"),
      label: "距離1 2エンド1本目",
      eventId: "event-1",
    });

    // Then: マスのキーで、距離の作成を待つ記録の操作になる
    expect(input).toEqual({
      key: "shot:d-a:2:1",
      label: "距離1 2エンド1本目",
      dependsOnKey: "distance:d-a",
      upsert: {
        shotEventId: "event-1",
        distanceId: "d-a",
        endNumber: 2,
        arrowNumber: 1,
        shooterId: "shooter-1",
        scoreStr: "X",
        scoreInt: 10,
      },
      operation: {
        type: "shot.recorded",
        eventId: "event-1",
        distanceId: "d-a",
        endNumber: 2,
        arrowNumber: 1,
        shooterId: "shooter-1",
        scoreStr: "X",
        scoreInt: 10,
      },
    });
  });

  it("クリアする場合、その距離の作成を待つクリアの操作にする", () => {
    // Given: 記録が無い
    // When: 送信キューへ積む入力に変換する
    const input = shotEnqueueInput({
      cell,
      shot: null,
      label: "距離1 2エンド1本目",
      eventId: "event-2",
    });

    // Then: マスのキーで、距離の作成を待つクリアの操作になる
    expect(input).toEqual({
      key: "shot:d-a:2:1",
      label: "距離1 2エンド1本目",
      dependsOnKey: "distance:d-a",
      clear: {
        shotEventId: "event-2",
        distanceId: "d-a",
        endNumber: 2,
        arrowNumber: 1,
      },
      operation: {
        type: "shot.cleared",
        eventId: "event-2",
        distanceId: "d-a",
        endNumber: 2,
        arrowNumber: 1,
      },
    });
  });
});
