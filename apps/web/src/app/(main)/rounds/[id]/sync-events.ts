export type SyncOperation =
  | {
      type: "round.updated";
      eventId: string;
      roundId: string;
      name: string;
      roundDate: string;
      format: string;
      bowType: string;
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
      distance: number | null;
      totalEnds: number;
      arrowsPerEnd: number;
      targetFaceId: string;
      isMarked: boolean;
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

// 操作の列へ追記する入力。labelは「同期失敗」の表示に使う操作名。
export type OpInput = { operation: SyncOperation; label: string };
