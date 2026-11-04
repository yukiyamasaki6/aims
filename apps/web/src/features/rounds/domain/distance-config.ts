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

// 入力の誤りの種類。required: 未入力。notPositiveInteger: 1以上の整数でない。
export type DistanceConfigError = "required" | "notPositiveInteger";
export type DistanceConfigErrors = {
  distance?: Extract<DistanceConfigError, "required">;
  arrowsPerEnd?: Extract<DistanceConfigError, "notPositiveInteger">;
  totalEnds?: Extract<DistanceConfigError, "notPositiveInteger">;
};

export type DistanceConfigValidation =
  | { type: "valid"; config: DistanceConfig }
  | { type: "invalid"; errors: DistanceConfigErrors };

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
    errors.distance = "required";
  }
  if (!isPositiveInteger(arrowsPerEnd)) {
    errors.arrowsPerEnd = "notPositiveInteger";
  }
  if (!isPositiveInteger(totalEnds)) {
    errors.totalEnds = "notPositiveInteger";
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
