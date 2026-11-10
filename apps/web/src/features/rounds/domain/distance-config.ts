import { DISTANCE_CONFIG_MAX } from "./round-constants";
import { type ScoringTargetFace, shotsFitDistance } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";

// エンドあたりの本数・総エンド数は、入力欄を一旦空にできるよう編集中はnullを許容する（距離（m）欄と同じ扱い）。
// number型のまま空文字をNumber("")=0として保持すると、常に「0」が残ってしまい消せなくなる。
export type DistanceDraft = Omit<Distance, "total_ends" | "arrows_per_end"> & {
  total_ends: number | null;
  arrows_per_end: number | null;
};

// 入力の誤りの種類。required: 未入力。notPositiveInteger: 1以上の整数でない。tooLarge: 上限を超える。shotsUnfit: 記録済みの矢が新しい構成に収まらない。
export type DistanceConfigError =
  | "required"
  | "notPositiveInteger"
  | "tooLarge"
  | "shotsUnfit";
export type DistanceConfigErrors = {
  distance?: Extract<
    DistanceConfigError,
    "required" | "notPositiveInteger" | "tooLarge"
  >;
  arrowsPerEnd?: Extract<
    DistanceConfigError,
    "notPositiveInteger" | "tooLarge"
  >;
  totalEnds?: Extract<DistanceConfigError, "notPositiveInteger" | "tooLarge">;
  // 総エンド数と本数の組が、記録済みの矢に収まらない。
  shotsUnfit?: Extract<DistanceConfigError, "shotsUnfit">;
};

export type DistanceConfigValidation =
  | { type: "valid"; distance: Distance }
  | { type: "invalid"; errors: DistanceConfigErrors };

// 値の範囲の判定。サーバーの規則(1以上の整数で、上限以下)に合わせる。
function rangeError(
  value: number,
): "notPositiveInteger" | "tooLarge" | undefined {
  if (!Number.isInteger(value) || value < 1) return "notPositiveInteger";
  if (value > DISTANCE_CONFIG_MAX) return "tooLarge";
  return undefined;
}

function countError(value: number | null) {
  return value === null ? "notPositiveInteger" : rangeError(value);
}

function distanceError(draft: DistanceDraft) {
  if (draft.distance === null) return draft.is_marked ? "required" : undefined;
  return rangeError(draft.distance);
}

// クライアントが既に持っている値だけで判定できるため、サーバーへ投げる前に同期的に検証する。
// 送信後の非同期エラーにはしない。
// `origin`は開いたときの距離で、総エンド数か本数がこれから変わるときだけ、`shots`(その距離の矢)が新しい構成に収まるかを判定する。的は記録済みの矢がある距離では変えられないため、`origin`の的で判定する。
export function validateDistanceDraft(
  draft: DistanceDraft,
  origin: Distance,
  shots: Shot[],
  targetFaces: ScoringTargetFace[],
): DistanceConfigValidation {
  const { arrows_per_end: arrowsPerEnd, total_ends: totalEnds } = draft;
  const errors: DistanceConfigErrors = {};
  const distance = distanceError(draft);
  if (distance) errors.distance = distance;
  const arrows = countError(arrowsPerEnd);
  if (arrows) errors.arrowsPerEnd = arrows;
  const ends = countError(totalEnds);
  if (ends) errors.totalEnds = ends;
  // 本数・エンド数を再度判定するのは、nullでないことを型へ伝えるため。
  if (
    Object.keys(errors).length > 0 ||
    arrowsPerEnd === null ||
    totalEnds === null
  ) {
    return { type: "invalid", errors };
  }
  const configChanged =
    totalEnds !== origin.total_ends || arrowsPerEnd !== origin.arrows_per_end;
  if (
    configChanged &&
    !shotsFitDistance(
      {
        id: origin.id,
        total_ends: totalEnds,
        arrows_per_end: arrowsPerEnd,
        target_face_id: origin.target_face_id,
      },
      shots,
      targetFaces,
    )
  ) {
    return { type: "invalid", errors: { shotsUnfit: "shotsUnfit" } };
  }
  return {
    type: "valid",
    distance: { ...draft, arrows_per_end: arrowsPerEnd, total_ends: totalEnds },
  };
}
