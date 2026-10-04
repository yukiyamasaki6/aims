// 保存で変えた項目だけの差分。値の無い(undefined)項目は変えない。
export type RoundChanges = Partial<{
  name: string;
  roundDate: string;
  format: string;
  bowType: string;
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
