import type { HistoryEntry, ShotState } from "./score-history";
import { endHasRoom } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";
import { newShotPointer, type Pointer } from "./shot-pointer";
import type { SyncOperation } from "./sync-events";

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
