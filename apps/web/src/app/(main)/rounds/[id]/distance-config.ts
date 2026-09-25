import { FILTER_ALL } from "./distance-config-constants";
import type { EnqueueInput } from "./sync-queue-types";

export type DistanceConfig = {
  id: string;
  distanceNumber: number;
  distance: number | null;
  totalEnds: number;
  arrowsPerEnd: number;
  targetFaceId: string;
  isMarked: boolean;
};

// エンドあたりの本数・総エンド数は、入力欄を一旦空にできるよう編集中はnullを許容する（距離（m）欄と同じ扱い）。
// number型のまま空文字をNumber("")=0として保持すると、常に「0」が残ってしまい消せなくなる。
export type DistanceDraft = Omit<
  DistanceConfig,
  "totalEnds" | "arrowsPerEnd"
> & {
  totalEnds: number | null;
  arrowsPerEnd: number | null;
};

export type DistanceConfigErrors = {
  distance?: string;
  arrowsPerEnd?: string;
  totalEnds?: string;
};

export type DistanceConfigValidation =
  | { type: "valid"; config: DistanceConfig }
  | { type: "invalid"; errors: DistanceConfigErrors };

const POSITIVE_INTEGER_ERROR = "1以上の整数を入力してください。";

function isPositiveInteger(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 1;
}

// クライアントが既に持っている値だけで判定できるため、サーバーへ投げる前に同期的に検証する。
// キュー経由の非同期エラーにはしない。
export function validateDistanceDraft(
  draft: DistanceDraft,
): DistanceConfigValidation {
  const { arrowsPerEnd, totalEnds } = draft;
  const errors: DistanceConfigErrors = {};
  if (draft.isMarked && draft.distance === null) {
    errors.distance = "距離を入力してください。";
  }
  if (!isPositiveInteger(arrowsPerEnd)) {
    errors.arrowsPerEnd = POSITIVE_INTEGER_ERROR;
  }
  if (!isPositiveInteger(totalEnds)) {
    errors.totalEnds = POSITIVE_INTEGER_ERROR;
  }
  // 本数・エンド数を再度判定するのは、nullでないことを型へ伝えるため。
  if (
    errors.distance === undefined &&
    isPositiveInteger(arrowsPerEnd) &&
    isPositiveInteger(totalEnds)
  ) {
    return { type: "valid", config: { ...draft, arrowsPerEnd, totalEnds } };
  }
  return { type: "invalid", errors };
}

type DistanceIdentity = Pick<DistanceConfig, "id" | "distanceNumber">;

function distanceSyncTarget(distance: DistanceIdentity) {
  return {
    key: `distance:${distance.id}`,
    label: `距離${distance.distanceNumber}`,
  };
}

export function buildDistanceUpdatedInput(
  config: DistanceConfig,
  eventId: string,
): EnqueueInput {
  return {
    ...distanceSyncTarget(config),
    operation: {
      type: "distance.updated",
      eventId,
      distanceId: config.id,
      distance: config.distance,
      totalEnds: config.totalEnds,
      arrowsPerEnd: config.arrowsPerEnd,
      targetFaceId: config.targetFaceId,
      isMarked: config.isMarked,
    },
  };
}

export function buildDistanceDisabledInput(
  distance: DistanceIdentity,
  eventId: string,
): EnqueueInput {
  return {
    ...distanceSyncTarget(distance),
    operation: {
      type: "distance.disabled",
      eventId,
      distanceId: distance.id,
    },
  };
}

// 種別・弓種のそれぞれについて、FILTER_ALLなら絞り込まない。
export function filterTargetFaces<
  T extends { format: string; bow_type: string[] },
>(targetFaces: T[], format: string, bowType: string): T[] {
  return targetFaces.filter(
    (f) =>
      (format === FILTER_ALL || f.format === format) &&
      (bowType === FILTER_ALL || f.bow_type.includes(bowType)),
  );
}
