// ラウンドの状態。入力中は記録や編集を続けている途中、完了は利用者が入力を終えたと示した状態。
export type RoundStatus = "in_progress" | "completed";

// 保存で変えた項目だけの差分。値の無い(undefined)項目は変えない。
export type RoundChanges = Partial<{
  name: string;
  roundDate: string;
  format: string;
  bowType: string;
  status: RoundStatus;
}>;

// 構成は的・エンド数・矢数の1組で、どれかが変われば3項目全てを持つ。
type DistanceConfigChange = {
  totalEnds: number;
  arrowsPerEnd: number;
  targetFaceId: string;
};

export type DistanceChanges = Partial<{
  distance: number | null;
  isMarked: boolean;
  config: DistanceConfigChange;
}>;

export type SyncOperation =
  | {
      type: "round.created";
      eventId: string;
      roundId: string;
      name: string;
      roundDate: string;
      format: string;
      bowType: string;
      distances: {
        eventId: string;
        id: string;
        positionKey: string;
        distance: number | null;
        isMarked: boolean;
        totalEnds: number;
        arrowsPerEnd: number;
        targetFaceId: string;
      }[];
    }
  | {
      type: "round.updated";
      eventId: string;
      roundId: string;
      changes: RoundChanges;
    }
  | { type: "round.disabled"; eventId: string; roundId: string }
  | {
      type: "distance.created";
      eventId: string;
      id: string;
      roundId: string;
      positionKey: string;
      distance: number | null;
      totalEnds: number;
      arrowsPerEnd: number;
      targetFaceId: string;
      isMarked: boolean;
    }
  | {
      type: "distance.updated";
      eventId: string;
      distanceId: string;
      changes: DistanceChanges;
    }
  | { type: "distance.disabled"; eventId: string; distanceId: string }
  | {
      type: "shot.recorded";
      eventId: string;
      distanceId: string;
      endNumber: number;
      arrowNumber: number;
      scoreStr: string;
      scoreInt: number;
      shooterId?: string;
    }
  | {
      type: "shot.cleared";
      eventId: string;
      distanceId: string;
      endNumber: number;
      arrowNumber: number;
    };

// 全項目を持つ旧い形式の`round.updated`・`distance.updated`を、全項目を変えた差分の操作として読み替える。
// 旧い形式の操作が端末に残らなくなった時点(次にDBのバージョンを上げるとき)で、この処理を削除する。
export function upgradeLegacyOperation(
  operation: SyncOperation,
): SyncOperation {
  const legacy: Record<string, unknown> = { ...operation };
  if (operation.type === "round.updated" && !("changes" in legacy)) {
    return {
      type: "round.updated",
      eventId: operation.eventId,
      roundId: operation.roundId,
      changes: {
        name: legacy.name as string,
        roundDate: legacy.roundDate as string,
        format: legacy.format as string,
        bowType: legacy.bowType as string,
      },
    };
  }
  if (operation.type === "distance.updated" && !("changes" in legacy)) {
    return {
      type: "distance.updated",
      eventId: operation.eventId,
      distanceId: operation.distanceId,
      changes: {
        distance: legacy.distance as number | null,
        isMarked: legacy.isMarked as boolean,
        config: {
          totalEnds: legacy.totalEnds as number,
          arrowsPerEnd: legacy.arrowsPerEnd as number,
          targetFaceId: legacy.targetFaceId as string,
        },
      },
    };
  }
  return operation;
}
