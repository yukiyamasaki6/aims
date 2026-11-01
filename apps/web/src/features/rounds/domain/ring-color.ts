import { type ScoringTargetFace, scoreKeysFor } from "./scorecard-scoring";

// 記録済みの玉の点数の実際のリング色を、テンキーと同じキー構成から引く。
// Mや的に無い点数は、的の外を表すM（キー構成の末尾）の色とする。
export function ringColorFor(
  targetFace: ScoringTargetFace | undefined,
  scoreStr: string,
): string {
  const keys = scoreKeysFor(targetFace);
  const key =
    keys.find((k) => k.scoreStr === scoreStr) ?? keys[keys.length - 1];
  return key.color;
}
