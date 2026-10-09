import type { SyncOperation } from "../_shared/sync-events";
import { endHasRoom } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";

// 指している矢。まだ記録していない新しい矢(エンドで決まる)か、記録済みの矢。何も指していないときはnull。
export type Pointer =
  | { kind: "new"; distanceId: string; endNumber: number }
  | { kind: "shot"; shotId: string; distanceId: string; endNumber: number }
  | null;

// 取り消しの列の1件が持つ、矢の状態。変えた属性(今は点数)と生死だけを持つ。
export type ShotState =
  | { alive: false }
  | { alive: true; scoreStr: string; scoreInt: number };

// 矢1本への1回の書き込み。戻るは`before`、進むは`after`で上書きする。
export type HistoryEntry = {
  shotId: string;
  distanceId: string;
  endNumber: number;
  before: ShotState;
  after: ShotState;
};

type HistoryStacks = {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
};

export function newShotPointer(distanceId: string, endNumber: number): Pointer {
  return { kind: "new", distanceId, endNumber };
}

export function shotPointer(shot: Shot): Pointer {
  return {
    kind: "shot",
    shotId: shot.id,
    distanceId: shot.distance_id,
    endNumber: shot.end_number,
  };
}

export function isSamePointer(a: Pointer, b: Pointer): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "shot" && b.kind === "shot") return a.shotId === b.shotId;
  return (
    a.kind === b.kind &&
    a.distanceId === b.distanceId &&
    a.endNumber === b.endNumber
  );
}

// 距離の中で、`fromEnd`以降の、矢数に達していない最初のエンドの新しい矢。無ければnull。
function openEndFrom(
  distance: Distance,
  shots: Shot[],
  fromEnd: number,
): Pointer {
  for (let end = fromEnd; end <= distance.total_ends; end++) {
    if (endHasRoom(distance, shots, end)) {
      return newShotPointer(distance.id, end);
    }
  }
  return null;
}

// 矢数に達していない最初のエンド(距離の並び順、エンドの昇順)の新しい矢。全て満杯ならnull。
// `distances`は並び順、`shots`は生きている矢とする。
export function firstOpenEnd(distances: Distance[], shots: Shot[]): Pointer {
  for (const distance of distances) {
    const pointer = openEndFrom(distance, shots, 1);
    if (pointer) return pointer;
  }
  return null;
}

// 点数を書いた後に指す矢。記録済みの矢はそのまま指す。
// 新しい矢は、そのエンドに空きがあれば同じエンド、満杯なら同じ距離で後ろの空きのあるエンド、無ければnull(距離をまたがない)。
// `shots`は書いた矢を含む。
export function pointerAfterScore(
  distances: Distance[],
  shots: Shot[],
  pointer: Pointer,
): Pointer {
  if (pointer?.kind !== "new") return pointer;
  const distance = distances.find((d) => d.id === pointer.distanceId);
  if (!distance) return null;
  return openEndFrom(distance, shots, pointer.endNumber);
}

// 指している矢を、いまの状態に合わせる。
// 記録済みの矢が消えたらそのエンドの新しい矢、新しい矢のエンドが満杯なら点数を書いた後と同じ規則で進む。
// 距離が無い、またはエンドが距離の範囲外になったら何も指さない。
export function reconcilePointer(
  distances: Distance[],
  shots: Shot[],
  pointer: Pointer,
): Pointer {
  if (pointer === null) return null;
  const distance = distances.find((d) => d.id === pointer.distanceId);
  if (!distance || pointer.endNumber > distance.total_ends) return null;
  if (pointer.kind === "shot" && shots.some((s) => s.id === pointer.shotId)) {
    return pointer;
  }
  const next = pointerAfterScore(
    distances,
    shots,
    newShotPointer(pointer.distanceId, pointer.endNumber),
  );
  return isSamePointer(next, pointer) ? pointer : next;
}

// 点数を書く1件。新しい矢は`newShotId`の矢として記録する。
export function scoreHistoryEntry(
  shots: Shot[],
  pointer: NonNullable<Pointer>,
  score: { scoreStr: string; scoreInt: number },
  newShotId: string,
): HistoryEntry {
  const shot =
    pointer.kind === "shot"
      ? shots.find((s) => s.id === pointer.shotId)
      : undefined;
  return {
    shotId: shot ? shot.id : newShotId,
    distanceId: pointer.distanceId,
    endNumber: pointer.endNumber,
    before: shot
      ? { alive: true, scoreStr: shot.score_str, scoreInt: shot.score_int }
      : { alive: false },
    after: { alive: true, ...score },
  };
}

// 記録済みの矢を消す1件。戻すときに同じ点数で復活させるため、前の点数を持つ。
export function clearHistoryEntry(shot: Shot): HistoryEntry {
  return {
    shotId: shot.id,
    distanceId: shot.distance_id,
    endNumber: shot.end_number,
    before: { alive: true, scoreStr: shot.score_str, scoreInt: shot.score_int },
    after: { alive: false },
  };
}

// 新たな書き込みを列に積み、やり直しの列を捨てる。
export function pushHistory(
  history: HistoryStacks,
  entry: HistoryEntry,
): HistoryStacks {
  return { undoStack: [...history.undoStack, entry], redoStack: [] };
}

// 直近の書き込みを取り消し、やり直しの列へ移す。取り消すものが無ければnull。
export function undoHistory(
  history: HistoryStacks,
): { entry: HistoryEntry; history: HistoryStacks } | null {
  const entry = history.undoStack.at(-1);
  if (!entry) return null;
  return {
    entry,
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, entry],
    },
  };
}

// 直近に取り消した書き込みをやり直し、取り消しの列へ戻す。やり直すものが無ければnull。
export function redoHistory(
  history: HistoryStacks,
): { entry: HistoryEntry; history: HistoryStacks } | null {
  const entry = history.redoStack.at(-1);
  if (!entry) return null;
  return {
    entry,
    history: {
      undoStack: [...history.undoStack, entry],
      redoStack: history.redoStack.slice(0, -1),
    },
  };
}

// 距離の構成の変更・削除で、その距離の矢への書き込みだけを捨てる。他の距離の書き込みは残す。
export function discardDistanceEntries(
  entries: HistoryEntry[],
  distanceId: string,
): HistoryEntry[] {
  return entries.filter((e) => e.distanceId !== distanceId);
}

// 矢を状態`state`にする操作。生きている状態は記録、消えた状態はクリアで、射手・射順は送らない。
// 距離の作成との順序は、操作の列の衝突の規則（同じ距離の操作は順に送る）が保つ。
export function buildShotOperation(
  entry: Pick<HistoryEntry, "shotId" | "distanceId" | "endNumber">,
  state: ShotState,
  eventId: string,
): SyncOperation {
  const { shotId, distanceId, endNumber } = entry;
  if (state.alive) {
    return {
      type: "shot.recorded",
      eventId,
      shotId,
      distanceId,
      endNumber,
      scoreStr: state.scoreStr,
      scoreInt: state.scoreInt,
    };
  }
  return { type: "shot.cleared", eventId, shotId, distanceId, endNumber };
}

// 戻る・進むで矢を`state`にする操作と、その後に指す矢。
// 戻した矢を指し、矢が消えたらそのエンドの新しい矢を指す。
// 復活がその時点のエンドに入らないときはnullで、操作を積まない(列は呼び出し側が進める)。
// `shots`は生きている矢とする。
export function replayHistoryEntry(
  distances: Distance[],
  shots: Shot[],
  entry: HistoryEntry,
  state: ShotState,
  eventId: string,
): { operation: SyncOperation; pointer: Pointer } | null {
  const distance = distances.find((d) => d.id === entry.distanceId);
  // 距離の削除と構成の変更でその距離の書き込みは捨てるため、距離は常にある(安全策)。
  if (!distance) return null;
  const revives = state.alive && !shots.some((s) => s.id === entry.shotId);
  if (revives && !endHasRoom(distance, shots, entry.endNumber)) return null;
  return {
    operation: buildShotOperation(entry, state, eventId),
    pointer: state.alive
      ? {
          kind: "shot",
          shotId: entry.shotId,
          distanceId: entry.distanceId,
          endNumber: entry.endNumber,
        }
      : newShotPointer(entry.distanceId, entry.endNumber),
  };
}

// 画面へまだ反映されていない自分の矢の操作を、生きている矢に重ねる。
// 空白・新しい矢・次のエンドの判定が、保存の完了を待たずに自分の追加を数えるために使う。
export function withPendingShots(
  shots: Shot[],
  pending: readonly SyncOperation[],
): Shot[] {
  let result = shots;
  for (const operation of pending) {
    if (operation.type === "shot.cleared") {
      result = result.filter((s) => s.id !== operation.shotId);
    } else if (operation.type === "shot.recorded") {
      const existing = result.find((s) => s.id === operation.shotId);
      const next: Shot = {
        shot_number: null,
        ...existing,
        id: operation.shotId,
        distance_id: operation.distanceId,
        end_number: operation.endNumber,
        score_str: operation.scoreStr,
        score_int: operation.scoreInt,
      };
      result = existing
        ? result.map((s) => (s.id === next.id ? next : s))
        : [...result, next];
    }
  }
  return result;
}
