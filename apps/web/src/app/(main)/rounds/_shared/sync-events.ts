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
      // 矢のID。新しい矢は端末が無作為のUUIDで作る。
      shotId: string;
      distanceId: string;
      endNumber: number;
      scoreStr: string;
      scoreInt: number;
      // 射手と射順は、変えるときだけ持つ。射順のnullは射順を外す(画面は付けない)。
      shooterId?: string;
      shotNumber?: number | null;
    }
  | {
      type: "shot.cleared";
      eventId: string;
      shotId: string;
      distanceId: string;
      endNumber: number;
    };
