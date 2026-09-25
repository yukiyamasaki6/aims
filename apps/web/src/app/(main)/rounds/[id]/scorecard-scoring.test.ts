import { describe, expect, it } from "vitest";
import {
  compareDistancePosition,
  distanceNumber,
  endSubtotal,
  type ScoringRing,
  type ScoringTargetFace,
  scoreKeysFor,
  summarizeDistance,
  summarizeRound,
} from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";

function ring(
  scoreStr: string,
  scoreInt: number,
  zIndex: number,
  color: string,
): ScoringRing {
  return { score_str: scoreStr, score_int: scoreInt, z_index: zIndex, color };
}

function face(id: string, rings: ScoringRing[]): ScoringTargetFace {
  return { id, target_face_spots: [{ target_face_rings: rings }] };
}

// Xのある10点的（リングは中心側から並べていない）。
const faceX = face("face-x", [
  ring("9", 9, 8, "#FFF200"),
  ring("X", 10, 10, "#FFF201"),
  ring("10", 10, 9, "#FFF202"),
  ring("8", 8, 7, "#ED1C24"),
]);

// Xの無い6点的。
const faceNoX = face("face-no-x", [
  ring("5", 5, 5, "#0066B3"),
  ring("6", 6, 6, "#FFF200"),
  ring("4", 4, 4, "#231F20"),
]);

function distance(
  id: string,
  positionKey: string,
  targetFaceId: string,
): Distance {
  return {
    id,
    position_key: positionKey,
    distance: 30,
    total_ends: 6,
    arrows_per_end: 6,
    target_face_id: targetFaceId,
    is_marked: true,
  };
}

function shot(distanceId: string, scoreStr: string, scoreInt: number): Shot {
  return {
    distance_id: distanceId,
    end_number: 1,
    arrow_number: 1,
    score_str: scoreStr,
    score_int: scoreInt,
  };
}

describe("compareDistancePosition", () => {
  it("position_keyの順に並べ、同じposition_keyではidの順に並べる", () => {
    // Given: position_keyとidの順が入り混じった距離
    const distances = [
      distance("d-2", "b", "face-x"),
      distance("d-3", "a", "face-x"),
      distance("d-1", "b", "face-x"),
    ];

    // When: 並べ替える
    const ids = [...distances].sort(compareDistancePosition).map((d) => d.id);

    // Then: position_key、idの順に並ぶ
    expect(ids).toEqual(["d-3", "d-1", "d-2"]);
  });
});

describe("distanceNumber", () => {
  it("配列の順ではなく並び順での番号を1始まりで返す", () => {
    // Given: 配列の順とposition_keyの順が異なる距離
    const distances = [
      distance("d-c", "c", "face-x"),
      distance("d-a", "a", "face-x"),
      distance("d-b", "b", "face-x"),
    ];

    // When: 各距離の番号を求める
    const numbers = ["d-a", "d-b", "d-c"].map((id) =>
      distanceNumber(distances, id),
    );

    // Then: position_keyの順で1から番号が振られる
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("存在しない距離は0を返す", () => {
    // Given: 距離の一覧
    const distances = [distance("d-a", "a", "face-x")];

    // When: 一覧に無い距離の番号を求める
    const result = distanceNumber(distances, "d-unknown");

    // Then: 0になる
    expect(result).toBe(0);
  });
});

describe("scoreKeysFor", () => {
  describe("的にリングがある場合", () => {
    it("中心側のリングから並べ、末尾にMを加える", () => {
      // Given: リングが中心側から並んでいない的
      // When: キー構成を求める
      const keys = scoreKeysFor(faceX);

      // Then: z_indexの大きい順に並び、末尾が固定のMになる
      expect(keys).toEqual([
        { scoreStr: "X", scoreInt: 10, color: "#FFF201" },
        { scoreStr: "10", scoreInt: 10, color: "#FFF202" },
        { scoreStr: "9", scoreInt: 9, color: "#FFF200" },
        { scoreStr: "8", scoreInt: 8, color: "#ED1C24" },
        { scoreStr: "M", scoreInt: 0, color: "#4CD964" },
      ]);
    });

    it("複数スポットの的では、全スポットの点数を点数ごとに1つにまとめる", () => {
      // Given: 同じ点数と、片方のスポットにだけある点数を持つ3つ目の的
      const tripleFace: ScoringTargetFace = {
        id: "face-triple",
        target_face_spots: [
          { target_face_rings: [ring("10", 10, 3, "#FFF200")] },
          {
            target_face_rings: [
              ring("10", 10, 3, "#FFF200"),
              ring("9", 9, 2, "#FFF200"),
            ],
          },
        ],
      };

      // When: キー構成を求める
      const keys = scoreKeysFor(tripleFace);

      // Then: 重複のない点数とMだけになる
      expect(keys).toEqual([
        { scoreStr: "10", scoreInt: 10, color: "#FFF200" },
        { scoreStr: "9", scoreInt: 9, color: "#FFF200" },
        { scoreStr: "M", scoreInt: 0, color: "#4CD964" },
      ]);
    });
  });

  describe("的にリングが無い場合", () => {
    it("的が見つからない・スポットが無い場合はMだけを返す", () => {
      // Given: 見つからない的と、スポットの無い的
      const faces = [undefined, { id: "face-blank", target_face_spots: [] }];

      // When: それぞれのキー構成を求める
      const results = faces.map((f) => scoreKeysFor(f));

      // Then: どちらもMだけになる
      expect(results).toEqual([
        [{ scoreStr: "M", scoreInt: 0, color: "#4CD964" }],
        [{ scoreStr: "M", scoreInt: 0, color: "#4CD964" }],
      ]);
    });
  });
});

describe("summarizeDistance", () => {
  describe("Xのある的の場合", () => {
    it("最高点数はXを含む実点数で、X数は種別で数え、合計にはその距離の記録だけを含める", () => {
      // Given: X・10・9・Mの記録と、別の距離の記録
      const shots = [
        shot("d-1", "X", 10),
        shot("d-1", "10", 10),
        shot("d-1", "9", 9),
        shot("d-1", "M", 0),
        shot("d-2", "X", 10),
      ];

      // When: 距離d-1を集計する
      const summary = summarizeDistance("d-1", faceX, shots);

      // Then: 最高点数「10」はXを含めて2本、X数は1本、合計は29になる
      expect(summary).toEqual({
        total: 29,
        topScores: {
          firstLabel: "10",
          firstCount: 2,
          secondLabel: "X",
          secondCount: 1,
        },
      });
    });

    it("Xでないリングが1つあれば集計し、Xだけの的では集計しない", () => {
      // Given: Xと10だけの的と、Xだけの的
      const xAnd10 = face("face-x10", [
        ring("X", 10, 2, "#FFF200"),
        ring("10", 10, 1, "#FFF200"),
      ]);
      const xOnly = face("face-x-only", [ring("X", 10, 1, "#FFF200")]);

      // When: それぞれの的で集計する
      const results = [xAnd10, xOnly].map(
        (f) => summarizeDistance("d-1", f, []).topScores,
      );

      // Then: Xだけの的では集計欄を持たない
      expect(results).toEqual([
        { firstLabel: "10", firstCount: 0, secondLabel: "X", secondCount: 0 },
        null,
      ]);
    });
  });

  describe("Xの無い的の場合", () => {
    it("最高点数と次点数を実点数で数える", () => {
      // Given: 6・5・5・4・Mの記録
      const shots = [
        shot("d-1", "6", 6),
        shot("d-1", "5", 5),
        shot("d-1", "5", 5),
        shot("d-1", "4", 4),
        shot("d-1", "M", 0),
      ];

      // When: 集計する
      const summary = summarizeDistance("d-1", faceNoX, shots);

      // Then: 最高点数「6」は1本、次点数「5」は2本、合計は20になる
      expect(summary).toEqual({
        total: 20,
        topScores: {
          firstLabel: "6",
          firstCount: 1,
          secondLabel: "5",
          secondCount: 2,
        },
      });
    });

    it("リングが2つあれば集計し、1つだけの的では集計しない", () => {
      // Given: リングが2つの的と1つの的
      const twoRings = face("face-two", [
        ring("6", 6, 2, "#FFF200"),
        ring("5", 5, 1, "#0066B3"),
      ]);
      const oneRing = face("face-one", [ring("6", 6, 1, "#FFF200")]);

      // When: それぞれの的で集計する
      const results = [twoRings, oneRing].map(
        (f) => summarizeDistance("d-1", f, []).topScores,
      );

      // Then: リングが1つの的では集計欄を持たない
      expect(results).toEqual([
        { firstLabel: "6", firstCount: 0, secondLabel: "5", secondCount: 0 },
        null,
      ]);
    });
  });

  describe("記録が無い場合", () => {
    it("合計・本数はいずれも0になる", () => {
      // Given: 記録の無い距離
      // When: 集計する
      const summary = summarizeDistance("d-1", faceX, []);

      // Then: すべて0になる
      expect(summary).toEqual({
        total: 0,
        topScores: {
          firstLabel: "10",
          firstCount: 0,
          secondLabel: "X",
          secondCount: 0,
        },
      });
    });
  });

  describe("的にリングが無い場合", () => {
    it("合計だけを求め、最高点数などは集計しない", () => {
      // Given: 見つからない的と、スポットの無い的
      const shots = [shot("d-1", "10", 10)];
      const faces = [undefined, { id: "face-blank", target_face_spots: [] }];

      // When: それぞれ集計する
      const results = faces.map((f) => summarizeDistance("d-1", f, shots));

      // Then: 合計だけを持つ
      expect(results).toEqual([
        { total: 10, topScores: null },
        { total: 10, topScores: null },
      ]);
    });
  });
});

describe("summarizeRound", () => {
  describe("全ての距離で的の点数構成が一致する場合", () => {
    it("全ての距離の記録をまとめて集計する", () => {
      // Given: 同じ的の2つの距離の記録
      const distances = [
        distance("d-1", "a", "face-x"),
        distance("d-2", "b", "face-x"),
      ];
      const shots = [
        shot("d-1", "X", 10),
        shot("d-2", "10", 10),
        shot("d-2", "9", 9),
      ];

      // When: ラウンド全体を集計する
      const summary = summarizeRound(distances, [faceX, faceNoX], shots);

      // Then: 両方の距離の記録を合わせた合計・本数になる
      expect(summary).toEqual({
        total: 29,
        topScores: {
          firstLabel: "10",
          firstCount: 2,
          secondLabel: "X",
          secondCount: 1,
        },
      });
    });

    it("的が異なっていても、X有無・最高点数・次点数が一致すれば集計する", () => {
      // Given: 色だけが異なる別の6点的の距離
      const otherNoX = face("face-no-x-2", [
        ring("6", 6, 2, "#000000"),
        ring("5", 5, 1, "#000000"),
      ]);
      const distances = [
        distance("d-1", "a", "face-no-x"),
        distance("d-2", "b", "face-no-x-2"),
      ];

      // When: ラウンド全体を集計する
      const summary = summarizeRound(
        distances,
        [faceNoX, otherNoX],
        [shot("d-2", "6", 6)],
      );

      // Then: 最高点数・次点数で集計する
      expect(summary.topScores).toEqual({
        firstLabel: "6",
        firstCount: 1,
        secondLabel: "5",
        secondCount: 0,
      });
    });
  });

  describe("距離間で的の点数構成が異なる場合", () => {
    it("X有無・最高点数・次点数のいずれかが異なれば、合計だけを求める", () => {
      // Given: 先頭の10点的に対し、Xの無い的・最高点数が異なる的・次点数が異なる的
      const xWith9Top = face("face-x9", [
        ring("X", 9, 2, "#FFF200"),
        ring("9", 9, 1, "#FFF200"),
      ]);
      const noXWith4Next = face("face-no-x-4", [
        ring("6", 6, 2, "#FFF200"),
        ring("4", 4, 1, "#231F20"),
      ]);
      const faces = [faceX, faceNoX, xWith9Top, noXWith4Next];
      const cases = [
        ["face-x", "face-no-x"],
        ["face-x", "face-x9"],
        ["face-no-x", "face-no-x-4"],
      ];
      const shots = [shot("d-1", "X", 10)];

      // When: それぞれの組み合わせでラウンド全体を集計する
      const results = cases.map(([first, second]) =>
        summarizeRound(
          [distance("d-1", "a", first), distance("d-2", "b", second)],
          faces,
          shots,
        ),
      );

      // Then: いずれも合計だけを持つ
      expect(results).toEqual([
        { total: 10, topScores: null },
        { total: 10, topScores: null },
        { total: 10, topScores: null },
      ]);
    });

    it("集計できない的の距離が含まれる場合は、合計だけを求める", () => {
      // Given: 先頭の距離の的が見つからない場合と、2つ目の距離の的が見つからない場合
      const cases = [
        ["face-unknown", "face-x"],
        ["face-x", "face-unknown"],
      ];

      // When: それぞれラウンド全体を集計する
      const results = cases.map(([first, second]) =>
        summarizeRound(
          [distance("d-1", "a", first), distance("d-2", "b", second)],
          [faceX],
          [shot("d-1", "10", 10)],
        ),
      );

      // Then: いずれも合計だけを持つ
      expect(results).toEqual([
        { total: 10, topScores: null },
        { total: 10, topScores: null },
      ]);
    });
  });

  describe("距離が無い場合", () => {
    it("合計0で、最高点数などは集計しない", () => {
      // Given: 距離も記録も無いラウンド
      // When: ラウンド全体を集計する
      const summary = summarizeRound([], [faceX], []);

      // Then: 合計0だけを持つ
      expect(summary).toEqual({ total: 0, topScores: null });
    });
  });
});

describe("endSubtotal", () => {
  it("エンドの記録の点数を合計し、Mは0点として数える", () => {
    // Given: X・9・Mの記録
    const endShots = [
      shot("d-1", "X", 10),
      shot("d-1", "9", 9),
      shot("d-1", "M", 0),
    ];

    // When: 小計を求める
    const subtotal = endSubtotal(endShots);

    // Then: 19になる
    expect(subtotal).toBe(19);
  });

  it("1本以上記録があれば全てMでも0を返し、記録が無ければ小計を持たない", () => {
    // Given: Mだけのエンドと、記録の無いエンド
    // When: それぞれの小計を求める
    const results = [[shot("d-1", "M", 0)], []].map((s) => endSubtotal(s));

    // Then: Mだけなら0、記録が無ければnullになる
    expect(results).toEqual([0, null]);
  });
});
