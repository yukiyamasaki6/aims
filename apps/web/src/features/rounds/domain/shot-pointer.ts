import { endHasRoom } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";

// 指している矢。まだ記録していない新しい矢(エンドで決まる)か、記録済みの矢。何も指していないときはnull。
export type Pointer =
  | { kind: "new"; distanceId: string; endNumber: number }
  | { kind: "shot"; shotId: string; distanceId: string; endNumber: number }
  | null;

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
