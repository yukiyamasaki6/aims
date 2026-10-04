import { FILTER_ALL } from "./distance-config-constants";
import type { DistanceChanges, SyncOperation } from "./sync-events";

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
// 送信後の非同期エラーにはしない。
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

// 保存した値と編集後の値の差分を、操作として返す。差分が無ければ操作を積まない。
// 構成は的・エンド数・矢数の1組で、どれかが変われば3項目全てを送る。
export function buildDistanceUpdatedOperation(
  saved: DistanceConfig,
  config: DistanceConfig,
  eventId: string,
): SyncOperation | null {
  const changes: DistanceChanges = {};
  if (config.distance !== saved.distance) changes.distance = config.distance;
  if (config.isMarked !== saved.isMarked) changes.isMarked = config.isMarked;
  if (
    config.totalEnds !== saved.totalEnds ||
    config.arrowsPerEnd !== saved.arrowsPerEnd ||
    config.targetFaceId !== saved.targetFaceId
  ) {
    changes.config = {
      totalEnds: config.totalEnds,
      arrowsPerEnd: config.arrowsPerEnd,
      targetFaceId: config.targetFaceId,
    };
  }
  if (Object.keys(changes).length === 0) return null;
  return {
    type: "distance.updated",
    eventId,
    distanceId: config.id,
    changes,
  };
}

export function buildDistanceDisabledOperation(
  distanceId: string,
  eventId: string,
): SyncOperation {
  return { type: "distance.disabled", eventId, distanceId };
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
