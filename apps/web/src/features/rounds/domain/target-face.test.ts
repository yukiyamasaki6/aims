import { describe, expect, it } from "vitest";
import {
  hasAllTargetFaces,
  lookupTargetFace,
  orderTargetFaces,
  type TargetFaceOption,
  targetFaceScoring,
} from "./target-face";
import {
  type SeedTargetFaceKey,
  seedTargetFace,
  seedTargetFaces,
  withReversedArrays,
} from "./target-face-test-helpers";

// 公式の的19件の表示順。
const SEED_ORDER = [
  "a1000000-0000-0000-0000-000000000001",
  "a1000000-0000-0000-0000-000000000002",
  "a1000000-0000-0000-0000-000000000003",
  "a1000000-0000-0000-0000-000000000004",
  "a1000000-0000-0000-0000-000000000005",
  "a1000000-0000-0000-0000-000000000006",
  "b1000000-0000-0000-0000-000000000001",
  "b1000000-0000-0000-0000-000000000003",
  "b1000000-0000-0000-0000-000000000004",
  "a1000000-0000-0000-0000-000000000007",
  "a1000000-0000-0000-0000-000000000008",
  "a1000000-0000-0000-0000-000000000009",
  "b1000000-0000-0000-0000-000000000002",
  "b1000000-0000-0000-0000-000000000005",
  "b1000000-0000-0000-0000-000000000006",
  "a1000000-0000-0000-0000-000000000010",
  "a1000000-0000-0000-0000-000000000011",
  "a1000000-0000-0000-0000-000000000012",
  "a1000000-0000-0000-0000-000000000013",
];

// 公式の的19件の得点の要約(下限、上限、Xの有無、10点の半径)。
const SEED_SCORING: [
  SeedTargetFaceKey,
  number,
  number,
  boolean,
  number | null,
][] = [
  ["A1", 1, 10, true, 6.1],
  ["A2", 1, 10, true, 4],
  ["A3", 5, 10, true, 4],
  ["A4", 1, 10, false, 3],
  ["A5", 6, 10, false, 3],
  ["A6", 6, 10, false, 3],
  ["B1", 1, 10, false, 1.5],
  ["B3", 6, 10, false, 1.5],
  ["B4", 6, 10, false, 1.5],
  ["A7", 1, 10, false, 2],
  ["A8", 6, 10, false, 2],
  ["A9", 6, 10, false, 2],
  ["B2", 1, 10, false, 1],
  ["B5", 6, 10, false, 1],
  ["B6", 6, 10, false, 1],
  ["A10", 1, 6, false, null],
  ["A11", 1, 6, false, null],
  ["A12", 1, 6, false, null],
  ["A13", 1, 6, false, null],
];

// 並びの規則を段ごとに確かめる合成の的。比較が読む属性と、点数帯の下限を決める1つのリングだけを持つ。
type Ranked = {
  id: string;
  format: string;
  size: number;
  bow_type: string[];
  placement: string;
  minScore: number;
};

function ranked({ minScore, ...attributes }: Ranked): TargetFaceOption {
  return {
    ...attributes,
    target_face_spots: [
      {
        center_x: 0,
        center_y: 0,
        target_face_rings: [
          {
            radius: 1,
            color: "#FFE552",
            line_color: null,
            z_index: 1,
            score_str: String(minScore),
            score_int: minScore,
          },
        ],
      },
    ],
  };
}

// 比較する段より下の条件で、先に並ぶ側の値と後に並ぶ側の値。
const FAVORED: Ranked = {
  id: "a",
  format: "indoor",
  size: 122,
  bow_type: ["recurve"],
  placement: "single",
  minScore: 1,
};
const DISFAVORED: Ranked = {
  id: "z",
  format: "indoor",
  size: 40,
  bow_type: ["compound"],
  placement: "vertical",
  minScore: 6,
};

const idsOf = (faces: TargetFaceOption[]) => faces.map((face) => face.id);

describe("orderTargetFaces", () => {
  it("公式の的19件を逆順で渡すと、表示順に並べる", () => {
    // Given

    // When
    const byId = new Map(seedTargetFaces().map((face) => [face.id, face]));
    const reversed = [...SEED_ORDER]
      .reverse()
      .map((id) => byId.get(id) as TargetFaceOption);
    const ordered = orderTargetFaces(reversed);

    // Then
    expect(idsOf(ordered)).toEqual(SEED_ORDER);
  });

  it("元の配列を並べ替えない", () => {
    // Given
    const records = [seedTargetFace("A10"), seedTargetFace("A1")];

    // When
    orderTargetFaces(records);

    // Then
    expect(idsOf(records)).toEqual([
      "a1000000-0000-0000-0000-000000000010",
      "a1000000-0000-0000-0000-000000000001",
    ]);
  });

  // 下の条件が逆の順を示す組合せは公式の的に無いものを含むが、段の優先の判定そのものが検証の対象である。
  it.each<[string, Ranked, Ranked]>([
    [
      "種別はoutdoorがindoorより先",
      { ...DISFAVORED, format: "outdoor" },
      { ...FAVORED, format: "indoor" },
    ],
    [
      "種別はindoorがfieldより先",
      { ...DISFAVORED, format: "indoor" },
      { ...FAVORED, format: "field" },
    ],
    [
      "サイズは大きい方が先",
      { ...DISFAVORED, size: 80 },
      { ...FAVORED, size: 60 },
    ],
    [
      "弓種はリカーブを含む的がコンパウンドだけの的より先",
      { ...DISFAVORED, size: 60, bow_type: ["recurve", "compound"] },
      { ...FAVORED, size: 60, bow_type: ["compound"] },
    ],
    [
      "配置は単一が三角三つ目より先",
      { ...DISFAVORED, size: 60, bow_type: ["recurve"], placement: "single" },
      { ...FAVORED, size: 60, placement: "triangle" },
    ],
    [
      "配置は三角三つ目が縦三つ目より先",
      {
        ...DISFAVORED,
        size: 60,
        bow_type: ["recurve"],
        placement: "triangle",
      },
      { ...FAVORED, size: 60, placement: "vertical" },
    ],
    [
      "点数帯は下限の低い方が先",
      {
        ...DISFAVORED,
        size: 60,
        bow_type: ["recurve"],
        placement: "single",
        minScore: 1,
      },
      { ...FAVORED, size: 60, minScore: 5 },
    ],
  ])("%s(下の条件が逆の順を示しても変わらない)", (_rule, first, second) => {
    // Given

    // When
    const ordered = orderTargetFaces([ranked(second), ranked(first)]);

    // Then
    expect(idsOf(ordered)).toEqual([first.id, second.id]);
  });

  // 公式の的にベアボウだけの的は無いが、弓種の群の判定が検証の対象である。
  it("ベアボウだけの的は、コンパウンドだけの的より先に並べる", () => {
    // Given

    // When
    const compoundOnly = ranked({ ...FAVORED, bow_type: ["compound"] });
    const barebowOnly = ranked({
      ...DISFAVORED,
      size: 122,
      bow_type: ["barebow"],
    });
    const ordered = orderTargetFaces([compoundOnly, barebowOnly]);

    // Then
    expect(idsOf(ordered)).toEqual(["z", "a"]);
  });

  // 公式の的に属性が全て同じ2件は無いが、同順位の並びの再現が検証の対象である。
  it("他の属性が同じならIDの昇順に並べ、渡す順によらない", () => {
    // Given

    // When
    const first = ranked({ ...FAVORED, id: "a" });
    const second = ranked({ ...FAVORED, id: "b" });
    const fromReversed = orderTargetFaces([second, first]);
    const fromOrdered = orderTargetFaces([first, second]);

    // Then
    expect(idsOf(fromReversed)).toEqual(["a", "b"]);
    expect(idsOf(fromOrdered)).toEqual(["a", "b"]);
  });

  it("弓種、スポット、リングの配列の順が逆でも、同じ順に並べる", () => {
    // Given

    // When
    const ordered = orderTargetFaces(seedTargetFaces().map(withReversedArrays));

    // Then
    expect(idsOf(ordered)).toEqual(SEED_ORDER);
  });
});

describe("targetFaceScoring", () => {
  it.each(SEED_SCORING)(
    "公式の的%sは、下限%s点、上限%s点、Xの有無%s、10点の半径%s(Xの半径ではない)を返す",
    (key, minScore, maxScore, hasX, tenRadius) => {
      // Given

      // When
      const face = seedTargetFace(key);
      const scoring = targetFaceScoring(face.target_face_spots);

      // Then
      expect(scoring).toEqual({ minScore, maxScore, hasX, tenRadius });
    },
  );

  it("スポットとリングの配列の順が逆でも、同じ要約を返す", () => {
    // Given

    // When
    const faces = SEED_SCORING.map(([key]) =>
      withReversedArrays(seedTargetFace(key)),
    );
    const scorings = faces.map((face) =>
      targetFaceScoring(face.target_face_spots),
    );

    // Then
    expect(scorings).toEqual(
      SEED_SCORING.map(([, minScore, maxScore, hasX, tenRadius]) => ({
        minScore,
        maxScore,
        hasX,
        tenRadius,
      })),
    );
  });
});

describe("lookupTargetFace", () => {
  const faces = [{ id: "a" }, { id: "b" }];

  it('一覧にidが無ければ"missing"を返す(空の一覧を含む)', () => {
    expect(lookupTargetFace(faces, "x")).toBe("missing");
    expect(lookupTargetFace([], "a")).toBe("missing");
  });

  it("一覧にidがあれば、その的を返す", () => {
    expect(lookupTargetFace(faces, "b")).toBe(faces[1]);
  });
});

describe("hasAllTargetFaces", () => {
  // 判定が見るのは的のIDと距離の的のIDだけなので、入力はそれだけを持つ形にする(判定そのものが検証の対象)。
  it("距離の参照する的が全て一覧にあれば真で、1つでも無ければ偽にする", () => {
    // Given
    const faces = [{ id: "face-1" }, { id: "face-2" }];

    // When
    const all = hasAllTargetFaces(faces, [
      { target_face_id: "face-1" },
      { target_face_id: "face-2" },
    ]);
    const missing = hasAllTargetFaces(faces, [
      { target_face_id: "face-1" },
      { target_face_id: "face-3" },
    ]);

    // Then
    expect(all).toBe(true);
    expect(missing).toBe(false);
  });

  it("距離が無ければ、的の一覧が空でも真にする", () => {
    // Given
    // When
    const result = hasAllTargetFaces([], []);

    // Then
    expect(result).toBe(true);
  });
});
