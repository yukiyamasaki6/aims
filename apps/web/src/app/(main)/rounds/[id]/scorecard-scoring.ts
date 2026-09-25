import { comparePositionKey } from "../_shared/position-key";
import type { Distance, Shot } from "./scorecard-types";

// 採点・集計に使う的のリング（描画用の半径・境界線などは扱わない）。
export type ScoringRing = {
  score_str: string;
  score_int: number;
  z_index: number;
  color: string;
};

// 採点・集計に使う的の構成。
export type ScoringTargetFace = {
  id: string;
  target_face_spots: { target_face_rings: ScoringRing[] }[];
};

// テンキーの1キー分の得点と配色。
export type ScoreKey = {
  scoreStr: string;
  scoreInt: number;
  color: string;
};

// 集計欄に出す2つの点数ラベルと、それぞれの本数。
// 表示順は常に「最高点数/X数」（Xが無い的では「最高点数/次点数」）。
export type TopScoreSummary = {
  firstLabel: string;
  firstCount: number;
  secondLabel: string;
  secondCount: number;
};

// 合計点と、集計できる場合の最高点数などの本数。
export type ScoreSummary = {
  total: number;
  topScores: TopScoreSummary | null;
};

// 集計欄の2つの点数を数える基準となるリング。
// XリングがあればsecondはXリング、無ければ次点のリングを指す。
type TopScoreRule = {
  hasX: boolean;
  first: ScoringRing;
  second: ScoringRing;
};

// Mは的のリングではなく「的の外」を表す固定の得点のため、的の構成によらず常に同じ点数・色を使う。
const MISS_SCORE: ScoreKey = { scoreStr: "M", scoreInt: 0, color: "#4CD964" };

export function compareDistancePosition(
  a: Pick<Distance, "id" | "position_key">,
  b: Pick<Distance, "id" | "position_key">,
): number {
  return comparePositionKey(a.position_key, a.id, b.position_key, b.id);
}

// 並び順（position_key）での距離の番号を1始まりで返す。
export function distanceNumber(
  distances: Pick<Distance, "id" | "position_key">[],
  distanceId: string,
): number {
  return (
    [...distances]
      .sort(compareDistancePosition)
      .findIndex((d) => d.id === distanceId) + 1
  );
}

// 距離の的に実在する点数のリングだけを、点数ごとに1つに重複排除して返す。
// 3つ目の的（トライアングル/バーティカル）は通常スポットごとに同一の点数構成だが、異なる可能性も考慮して全スポットのリングを対象にする。
function uniqueRingsFor(targetFace: ScoringTargetFace | undefined) {
  const allRings = (targetFace?.target_face_spots ?? []).flatMap(
    (spot) => spot.target_face_rings,
  );
  return Array.from(new Map(allRings.map((r) => [r.score_str, r])).values());
}

function ringsByZIndexDesc(targetFace: ScoringTargetFace | undefined) {
  return uniqueRingsFor(targetFace).sort((a, b) => b.z_index - a.z_index);
}

// 的にXリングがあるかどうかで、集計欄に出す2つの点数の基準を決める。
// Xリングがあれば「最高点数（Xを含む実点数）/X数」、無ければ「最高点数/次点数」とする。
// フィールド的のように最高点が10未満の的でも、実在する点数で動的に決まる。
function topScoreRuleFor(
  targetFace: ScoringTargetFace | undefined,
): TopScoreRule | null {
  const rings = ringsByZIndexDesc(targetFace);
  const top = rings[0];
  if (!top) return null;

  const hasX = top.score_str === "X";
  const [first, next] = rings.filter((r) => r.score_str !== "X");
  if (!first) return null;
  if (hasX) return { hasX, first, second: top };
  if (!next) return null;
  return { hasX, first, second: next };
}

// ラウンド全体の集計は、全ての距離で的のX有無・最高点数・次点数が一致する場合のみ意味を持つ。
// 例えば18mが10点的・30mが6点的だと「X数」も「10」も両方の距離を跨いで比較できないため、一致しなければnullを返す。
// 一致する場合、カウントの基準となるリング構成は先頭の距離の的を代表として使う。
function roundTopScoreRule(
  distances: Distance[],
  targetFaces: ScoringTargetFace[],
): TopScoreRule | null {
  const perDistance = distances.map((d) =>
    topScoreRuleFor(targetFaces.find((f) => f.id === d.target_face_id)),
  );
  const first = perDistance[0];
  if (!first) return null;

  const allSame = perDistance.every(
    (rule) =>
      rule !== null &&
      rule.hasX === first.hasX &&
      rule.first.score_str === first.first.score_str &&
      rule.second.score_str === first.second.score_str,
  );
  return allSame ? first : null;
}

// X以外は常に実点数（score_int）で数える。
// 最高点数はXも含めた実点数で数える（Xは最高点数のリングに含まれる特別な当たりであり、別の点数帯ではないため）。
// X数だけはリング種別（score_str）で数える（score_intだけでは「10」と区別できないため）。
function countTopScores(rule: TopScoreRule, shots: Shot[]): TopScoreSummary {
  const firstCount = shots.filter(
    (s) => s.score_int === rule.first.score_int,
  ).length;
  const secondCount = rule.hasX
    ? shots.filter((s) => s.score_str === "X").length
    : shots.filter((s) => s.score_int === rule.second.score_int).length;
  return {
    firstLabel: rule.first.score_str,
    firstCount,
    secondLabel: rule.second.score_str,
    secondCount,
  };
}

function sumScores(shots: Shot[]): number {
  return shots.reduce((sum, s) => sum + s.score_int, 0);
}

function summarize(rule: TopScoreRule | null, shots: Shot[]): ScoreSummary {
  return {
    total: sumScores(shots),
    topScores: rule ? countTopScores(rule, shots) : null,
  };
}

// 距離の的に実在する点数だけを、中心側（z_indexの大きい順）から並べ、末尾に固定のMを加えてテンキーのキーとする。
// 的によってリング数が異なる（例: 6点的は1〜4が無い）ため、固定のキー一覧は持たない。
export function scoreKeysFor(
  targetFace: ScoringTargetFace | undefined,
): ScoreKey[] {
  const scoreKeys = ringsByZIndexDesc(targetFace).map((r) => ({
    scoreStr: r.score_str,
    scoreInt: r.score_int,
    color: r.color,
  }));
  return [...scoreKeys, MISS_SCORE];
}

// ラウンド全体の合計点と、全ての距離の的で集計できる場合の最高点数などの本数を求める。
export function summarizeRound(
  distances: Distance[],
  targetFaces: ScoringTargetFace[],
  shots: Shot[],
): ScoreSummary {
  return summarize(roundTopScoreRule(distances, targetFaces), shots);
}

// 距離の合計点と、その距離の的で集計できる場合の最高点数などの本数を求める。
export function summarizeDistance(
  distanceId: string,
  targetFace: ScoringTargetFace | undefined,
  shots: Shot[],
): ScoreSummary {
  return summarize(
    topScoreRuleFor(targetFace),
    shots.filter((s) => s.distance_id === distanceId),
  );
}

// エンドの小計を求める。
// 1本も記録されていないエンドは、0点と区別して小計を持たない（null）。
export function endSubtotal(endShots: Shot[]): number | null {
  if (endShots.length === 0) return null;
  return sumScores(endShots);
}
