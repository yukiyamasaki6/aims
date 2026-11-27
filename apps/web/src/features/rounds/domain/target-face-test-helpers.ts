import type { TargetFaceOption, TargetFaceRing } from "./target-face";

// シード(`supabase/migrations/20261117000002_target_faces.sql`)の公式の的19件を、取得の形で写した値。配置はIDごとの固定の割り当てである。
// 表示の順と説明は持たせず、期待値は各テストが書く。

type RingRow = readonly [
  radius: number,
  color: string,
  lineColor: string | null,
  zIndex: number,
  scoreStr: string,
  scoreInt: number,
];

type FaceRow = {
  id: string;
  format: "outdoor" | "indoor" | "field";
  size: number;
  bowTypes: readonly ("recurve" | "compound" | "barebow")[];
  placement: "single" | "triangle" | "vertical";
  centers: readonly (readonly [x: number, y: number])[];
  // 同じ的のスポットは、同じリングを持つ。
  rings: readonly RingRow[];
};

const SEED_ROWS = {
  A1: {
    id: "a1000000-0000-0000-0000-000000000001",
    format: "outdoor",
    size: 122,
    bowTypes: ["recurve", "compound", "barebow"],
    placement: "single",
    centers: [[0, 0]],
    rings: [
      [3.05, "#FFE552", "#231F20", 11, "X", 10],
      [6.1, "#FFE552", "#231F20", 10, "10", 10],
      [12.2, "#FFE552", "#231F20", 9, "9", 9],
      [18.3, "#F65058", "#231F20", 8, "8", 8],
      [24.4, "#F65058", "#231F20", 7, "7", 7],
      [30.5, "#00B4E4", "#231F20", 6, "6", 6],
      [36.6, "#00B4E4", null, 5, "5", 5],
      [42.7, "#231F20", "#FFFFFF", 4, "4", 4],
      [48.8, "#231F20", null, 3, "3", 3],
      [54.9, "#FFFFFF", "#231F20", 2, "2", 2],
      [61, "#FFFFFF", "#231F20", 1, "1", 1],
    ],
  },
  A2: {
    id: "a1000000-0000-0000-0000-000000000002",
    format: "outdoor",
    size: 80,
    bowTypes: ["recurve", "compound", "barebow"],
    placement: "single",
    centers: [[0, 0]],
    rings: [
      [2, "#FFE552", "#231F20", 11, "X", 10],
      [4, "#FFE552", "#231F20", 10, "10", 10],
      [8, "#FFE552", "#231F20", 9, "9", 9],
      [12, "#F65058", "#231F20", 8, "8", 8],
      [16, "#F65058", "#231F20", 7, "7", 7],
      [20, "#00B4E4", "#231F20", 6, "6", 6],
      [24, "#00B4E4", null, 5, "5", 5],
      [28, "#231F20", "#FFFFFF", 4, "4", 4],
      [32, "#231F20", null, 3, "3", 3],
      [36, "#FFFFFF", "#231F20", 2, "2", 2],
      [40, "#FFFFFF", "#231F20", 1, "1", 1],
    ],
  },
  A3: {
    id: "a1000000-0000-0000-0000-000000000003",
    format: "outdoor",
    size: 80,
    bowTypes: ["recurve", "compound", "barebow"],
    placement: "single",
    centers: [[0, 0]],
    rings: [
      [2, "#FFE552", "#231F20", 7, "X", 10],
      [4, "#FFE552", "#231F20", 6, "10", 10],
      [8, "#FFE552", "#231F20", 5, "9", 9],
      [12, "#F65058", "#231F20", 4, "8", 8],
      [16, "#F65058", "#231F20", 3, "7", 7],
      [20, "#00B4E4", "#231F20", 2, "6", 6],
      [24, "#00B4E4", "#231F20", 1, "5", 5],
    ],
  },
  A4: {
    id: "a1000000-0000-0000-0000-000000000004",
    format: "indoor",
    size: 60,
    bowTypes: ["recurve", "barebow"],
    placement: "single",
    centers: [[0, 0]],
    rings: [
      [3, "#FFE552", "#231F20", 10, "10", 10],
      [6, "#FFE552", "#231F20", 9, "9", 9],
      [9, "#F65058", "#231F20", 8, "8", 8],
      [12, "#F65058", "#231F20", 7, "7", 7],
      [15, "#00B4E4", "#231F20", 6, "6", 6],
      [18, "#00B4E4", null, 5, "5", 5],
      [21, "#231F20", "#FFFFFF", 4, "4", 4],
      [24, "#231F20", null, 3, "3", 3],
      [27, "#FFFFFF", "#231F20", 2, "2", 2],
      [30, "#FFFFFF", "#231F20", 1, "1", 1],
    ],
  },
  A5: {
    id: "a1000000-0000-0000-0000-000000000005",
    format: "indoor",
    size: 60,
    bowTypes: ["recurve", "barebow"],
    placement: "triangle",
    centers: [
      [0, 18.48],
      [-16, -9.24],
      [16, -9.24],
    ],
    rings: [
      [3, "#FFE552", "#231F20", 5, "10", 10],
      [6, "#FFE552", "#231F20", 4, "9", 9],
      [9, "#F65058", "#231F20", 3, "8", 8],
      [12, "#F65058", "#231F20", 2, "7", 7],
      [15, "#00B4E4", "#231F20", 1, "6", 6],
    ],
  },
  A6: {
    id: "a1000000-0000-0000-0000-000000000006",
    format: "indoor",
    size: 60,
    bowTypes: ["recurve", "barebow"],
    placement: "vertical",
    centers: [
      [0, 32],
      [0, 0],
      [0, -32],
    ],
    rings: [
      [3, "#FFE552", "#231F20", 5, "10", 10],
      [6, "#FFE552", "#231F20", 4, "9", 9],
      [9, "#F65058", "#231F20", 3, "8", 8],
      [12, "#F65058", "#231F20", 2, "7", 7],
      [15, "#00B4E4", "#231F20", 1, "6", 6],
    ],
  },
  A7: {
    id: "a1000000-0000-0000-0000-000000000007",
    format: "indoor",
    size: 40,
    bowTypes: ["recurve", "barebow"],
    placement: "single",
    centers: [[0, 0]],
    rings: [
      [2, "#FFE552", "#231F20", 10, "10", 10],
      [4, "#FFE552", "#231F20", 9, "9", 9],
      [6, "#F65058", "#231F20", 8, "8", 8],
      [8, "#F65058", "#231F20", 7, "7", 7],
      [10, "#00B4E4", "#231F20", 6, "6", 6],
      [12, "#00B4E4", null, 5, "5", 5],
      [14, "#231F20", "#FFFFFF", 4, "4", 4],
      [16, "#231F20", null, 3, "3", 3],
      [18, "#FFFFFF", "#231F20", 2, "2", 2],
      [20, "#FFFFFF", "#231F20", 1, "1", 1],
    ],
  },
  A8: {
    id: "a1000000-0000-0000-0000-000000000008",
    format: "indoor",
    size: 40,
    bowTypes: ["recurve", "barebow"],
    placement: "triangle",
    centers: [
      [0, 12.7],
      [-11, -6.35],
      [11, -6.35],
    ],
    rings: [
      [2, "#FFE552", "#231F20", 5, "10", 10],
      [4, "#FFE552", "#231F20", 4, "9", 9],
      [6, "#F65058", "#231F20", 3, "8", 8],
      [8, "#F65058", "#231F20", 2, "7", 7],
      [10, "#00B4E4", "#231F20", 1, "6", 6],
    ],
  },
  A9: {
    id: "a1000000-0000-0000-0000-000000000009",
    format: "indoor",
    size: 40,
    bowTypes: ["recurve", "barebow"],
    placement: "vertical",
    centers: [
      [0, 22],
      [0, 0],
      [0, -22],
    ],
    rings: [
      [2, "#FFE552", "#231F20", 5, "10", 10],
      [4, "#FFE552", "#231F20", 4, "9", 9],
      [6, "#F65058", "#231F20", 3, "8", 8],
      [8, "#F65058", "#231F20", 2, "7", 7],
      [10, "#00B4E4", "#231F20", 1, "6", 6],
    ],
  },
  A10: {
    id: "a1000000-0000-0000-0000-000000000010",
    format: "field",
    size: 80,
    bowTypes: ["recurve", "compound", "barebow"],
    placement: "single",
    centers: [[0, 0]],
    rings: [
      [6.67, "#FFE552", "#231F20", 6, "6", 6],
      [13.33, "#FFE552", null, 5, "5", 5],
      [20, "#231F20", "#FFFFFF", 4, "4", 4],
      [26.67, "#231F20", "#FFFFFF", 3, "3", 3],
      [33.33, "#231F20", "#FFFFFF", 2, "2", 2],
      [40, "#231F20", "#FFFFFF", 1, "1", 1],
    ],
  },
  A11: {
    id: "a1000000-0000-0000-0000-000000000011",
    format: "field",
    size: 60,
    bowTypes: ["recurve", "compound", "barebow"],
    placement: "single",
    centers: [[0, 0]],
    rings: [
      [5, "#FFE552", "#231F20", 6, "6", 6],
      [10, "#FFE552", null, 5, "5", 5],
      [15, "#231F20", "#FFFFFF", 4, "4", 4],
      [20, "#231F20", "#FFFFFF", 3, "3", 3],
      [25, "#231F20", "#FFFFFF", 2, "2", 2],
      [30, "#231F20", "#FFFFFF", 1, "1", 1],
    ],
  },
  A12: {
    id: "a1000000-0000-0000-0000-000000000012",
    format: "field",
    size: 40,
    bowTypes: ["recurve", "compound", "barebow"],
    placement: "single",
    centers: [[0, 0]],
    rings: [
      [3.33, "#FFE552", "#231F20", 6, "6", 6],
      [6.67, "#FFE552", null, 5, "5", 5],
      [10, "#231F20", "#FFFFFF", 4, "4", 4],
      [13.33, "#231F20", "#FFFFFF", 3, "3", 3],
      [16.67, "#231F20", "#FFFFFF", 2, "2", 2],
      [20, "#231F20", "#FFFFFF", 1, "1", 1],
    ],
  },
  A13: {
    id: "a1000000-0000-0000-0000-000000000013",
    format: "field",
    size: 20,
    bowTypes: ["recurve", "compound", "barebow"],
    placement: "vertical",
    centers: [
      [0, 22],
      [0, 0],
      [0, -22],
    ],
    rings: [
      [1.67, "#FFE552", "#231F20", 6, "6", 6],
      [3.33, "#FFE552", null, 5, "5", 5],
      [5, "#231F20", "#FFFFFF", 4, "4", 4],
      [6.67, "#231F20", "#FFFFFF", 3, "3", 3],
      [8.33, "#231F20", "#FFFFFF", 2, "2", 2],
      [10, "#231F20", "#FFFFFF", 1, "1", 1],
    ],
  },
  B1: {
    id: "b1000000-0000-0000-0000-000000000001",
    format: "indoor",
    size: 60,
    bowTypes: ["compound"],
    placement: "single",
    centers: [[0, 0]],
    rings: [
      [1.5, "#FFE552", "#231F20", 11, "10", 10],
      [6, "#FFE552", "#231F20", 9, "9", 9],
      [9, "#F65058", "#231F20", 8, "8", 8],
      [12, "#F65058", "#231F20", 7, "7", 7],
      [15, "#00B4E4", "#231F20", 6, "6", 6],
      [18, "#00B4E4", null, 5, "5", 5],
      [21, "#231F20", "#FFFFFF", 4, "4", 4],
      [24, "#231F20", null, 3, "3", 3],
      [27, "#FFFFFF", "#231F20", 2, "2", 2],
      [30, "#FFFFFF", "#231F20", 1, "1", 1],
    ],
  },
  B2: {
    id: "b1000000-0000-0000-0000-000000000002",
    format: "indoor",
    size: 40,
    bowTypes: ["compound"],
    placement: "single",
    centers: [[0, 0]],
    rings: [
      [1, "#FFE552", "#231F20", 11, "10", 10],
      [4, "#FFE552", "#231F20", 9, "9", 9],
      [6, "#F65058", "#231F20", 8, "8", 8],
      [8, "#F65058", "#231F20", 7, "7", 7],
      [10, "#00B4E4", "#231F20", 6, "6", 6],
      [12, "#00B4E4", null, 5, "5", 5],
      [14, "#231F20", "#FFFFFF", 4, "4", 4],
      [16, "#231F20", null, 3, "3", 3],
      [18, "#FFFFFF", "#231F20", 2, "2", 2],
      [20, "#FFFFFF", "#231F20", 1, "1", 1],
    ],
  },
  B3: {
    id: "b1000000-0000-0000-0000-000000000003",
    format: "indoor",
    size: 60,
    bowTypes: ["compound"],
    placement: "triangle",
    centers: [
      [0, 18.48],
      [-16, -9.24],
      [16, -9.24],
    ],
    rings: [
      [1.5, "#FFE552", "#231F20", 6, "10", 10],
      [6, "#FFE552", "#231F20", 4, "9", 9],
      [9, "#F65058", "#231F20", 3, "8", 8],
      [12, "#F65058", "#231F20", 2, "7", 7],
      [15, "#00B4E4", "#231F20", 1, "6", 6],
    ],
  },
  B4: {
    id: "b1000000-0000-0000-0000-000000000004",
    format: "indoor",
    size: 60,
    bowTypes: ["compound"],
    placement: "vertical",
    centers: [
      [0, 32],
      [0, 0],
      [0, -32],
    ],
    rings: [
      [1.5, "#FFE552", "#231F20", 6, "10", 10],
      [6, "#FFE552", "#231F20", 4, "9", 9],
      [9, "#F65058", "#231F20", 3, "8", 8],
      [12, "#F65058", "#231F20", 2, "7", 7],
      [15, "#00B4E4", "#231F20", 1, "6", 6],
    ],
  },
  B5: {
    id: "b1000000-0000-0000-0000-000000000005",
    format: "indoor",
    size: 40,
    bowTypes: ["compound"],
    placement: "triangle",
    centers: [
      [0, 12.7],
      [-11, -6.35],
      [11, -6.35],
    ],
    rings: [
      [1, "#FFE552", "#231F20", 6, "10", 10],
      [4, "#FFE552", "#231F20", 4, "9", 9],
      [6, "#F65058", "#231F20", 3, "8", 8],
      [8, "#F65058", "#231F20", 2, "7", 7],
      [10, "#00B4E4", "#231F20", 1, "6", 6],
    ],
  },
  B6: {
    id: "b1000000-0000-0000-0000-000000000006",
    format: "indoor",
    size: 40,
    bowTypes: ["compound"],
    placement: "vertical",
    centers: [
      [0, 22],
      [0, 0],
      [0, -22],
    ],
    rings: [
      [1, "#FFE552", "#231F20", 6, "10", 10],
      [4, "#FFE552", "#231F20", 4, "9", 9],
      [6, "#F65058", "#231F20", 3, "8", 8],
      [8, "#F65058", "#231F20", 2, "7", 7],
      [10, "#00B4E4", "#231F20", 1, "6", 6],
    ],
  },
} as const satisfies Record<string, FaceRow>;

export type SeedTargetFaceKey = keyof typeof SEED_ROWS;

function toRing(row: RingRow): TargetFaceRing {
  const [radius, color, lineColor, zIndex, scoreStr, scoreInt] = row;
  return {
    radius,
    color,
    line_color: lineColor,
    z_index: zIndex,
    score_str: scoreStr,
    score_int: scoreInt,
  };
}

// 呼ぶたびに別のオブジェクトを返し、テストが書き換えても他のテストに及ばないようにする。
export function seedTargetFace(key: SeedTargetFaceKey): TargetFaceOption {
  const row: FaceRow = SEED_ROWS[key];
  return {
    id: row.id,
    format: row.format,
    size: row.size,
    bow_type: [...row.bowTypes],
    placement: row.placement,
    target_face_spots: row.centers.map(([x, y]) => ({
      center_x: x,
      center_y: y,
      target_face_rings: row.rings.map(toRing),
    })),
  };
}

// 19件をIDの順に返す。
export function seedTargetFaces(): TargetFaceOption[] {
  return (Object.keys(SEED_ROWS) as SeedTargetFaceKey[]).map(seedTargetFace);
}

// 弓種、スポット、リングの配列を逆にした的。並びに結果が依存しないことを確かめるために使う。
export function withReversedArrays(face: TargetFaceOption): TargetFaceOption {
  return {
    ...face,
    bow_type: [...face.bow_type].reverse(),
    target_face_spots: [...face.target_face_spots].reverse().map((spot) => ({
      ...spot,
      target_face_rings: [...spot.target_face_rings].reverse(),
    })),
  };
}
