import type { Tables } from "@/types/supabase";
import { FORMAT_OPTIONS } from "./round-constants";

export type TargetFaceRing = Pick<
  Tables<"target_face_rings">,
  "radius" | "color" | "line_color" | "z_index" | "score_str" | "score_int"
>;

export type TargetFaceSpotLayout = Pick<
  Tables<"target_face_spots">,
  "center_x" | "center_y"
> & {
  target_face_rings: TargetFaceRing[];
};

export type TargetFaceLayout = {
  size: number;
  target_face_spots: TargetFaceSpotLayout[];
};

// 的の一覧に見つからなければ"missing"。
export type TargetFaceView = TargetFaceLayout | "missing";

export function lookupTargetFace<T extends { id: string }>(
  faces: T[],
  id: string,
): T | "missing" {
  return faces.find((f) => f.id === id) ?? "missing";
}

export type TargetFaceOption = Pick<
  Tables<"target_faces">,
  "id" | "placement" | "size" | "format" | "bow_type"
> & {
  target_face_spots: TargetFaceSpotLayout[];
};

// 配置の分類。値はDBのCHECKで選択肢のどれかに限られ、並びは一覧の表示順に使う。
const PLACEMENT_OPTIONS = ["single", "triangle", "vertical"] as const;
export type PlacementOption = (typeof PLACEMENT_OPTIONS)[number];

export type TargetFaceScoring = {
  minScore: number;
  maxScore: number;
  hasX: boolean;
  // 10点のリングが無ければnull。
  tenRadius: number | null;
};

// 全スポットのリングから、点数帯と中心の要約を得る。同じ的のスポットは、同じ得点構成を持つ前提とする。
export function targetFaceScoring(
  spots: readonly TargetFaceSpotLayout[],
): TargetFaceScoring {
  const rings = spots.flatMap((spot) => spot.target_face_rings);
  const scores = rings.map((ring) => ring.score_int);
  // Xも10点のため、半径は表記が"10"のリングから得る。
  const ten = rings.find(
    (ring) => ring.score_str === "10" && ring.score_int === 10,
  );
  return {
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
    hasX: rings.some((ring) => ring.score_str === "X"),
    tenRadius: ten?.radius ?? null,
  };
}

function optionIndex(options: readonly string[], value: string): number {
  return options.indexOf(value);
}

// リカーブかベアボウに対応する的は0、コンパウンドだけの的は1。
function bowGroupOf(face: TargetFaceOption): number {
  return face.bow_type.some(
    (bowType) => bowType === "recurve" || bowType === "barebow",
  )
    ? 0
    : 1;
}

// 種類(outdoor→indoor→field)→サイズ(大→小)→弓種(リカーブかベアボウを含む→コンパウンドだけ)→配置→点数帯の下限(低→高)の順に並べる。IDは同順位の並びを再現するためだけに使う。
function compareTargetFaces(a: TargetFaceOption, b: TargetFaceOption): number {
  return (
    optionIndex(FORMAT_OPTIONS, a.format) -
      optionIndex(FORMAT_OPTIONS, b.format) ||
    b.size - a.size ||
    bowGroupOf(a) - bowGroupOf(b) ||
    optionIndex(PLACEMENT_OPTIONS, a.placement) -
      optionIndex(PLACEMENT_OPTIONS, b.placement) ||
    targetFaceScoring(a.target_face_spots).minScore -
      targetFaceScoring(b.target_face_spots).minScore ||
    a.id.localeCompare(b.id)
  );
}

export function orderTargetFaces(
  records: readonly TargetFaceOption[],
): TargetFaceOption[] {
  return [...records].sort(compareTargetFaces);
}

// 的の一覧が、距離の参照する的を全て含むか。距離が無ければ含む。
export function hasAllTargetFaces(
  faces: readonly { id: string }[],
  distances: readonly { target_face_id: string }[],
): boolean {
  return distances.every((distance) =>
    faces.some((face) => face.id === distance.target_face_id),
  );
}
