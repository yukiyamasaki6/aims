import { nextPositionKey } from "./position-key";
import { compareDistancePosition } from "./scorecard-scoring";
import type { Distance } from "./scorecard-types";
import type { DistanceChanges, SyncOperation } from "./sync-events";

// 10点的（アウトドア・122cm）。
// 距離が1件も無い状態で追加する距離の的として使う（e2eのcreate-round APIヘルパーが使う既定の的と同じもの）。
const DEFAULT_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001";

// 追加する距離と、その作成の操作を返す。
// 並び順で最後の距離の内容を引き継ぎ、距離が1件も無い場合は既定の内容にする。
// 最後の距離の距離（m）が未設定の場合は、距離（m）だけ既定の値にする。
// IDは楽観的UIのため呼び出し側で確定したものを使う。
export function distanceToAdd(
  distances: Distance[],
  ids: { id: string; eventId: string; roundId: string },
): { distance: Distance; operation: SyncOperation } {
  const last = [...distances].sort(compareDistancePosition).at(-1);
  const distance: Distance = {
    id: ids.id,
    position_key: last ? nextPositionKey(last.position_key) : "a",
    distance: last?.distance ?? 70,
    total_ends: last?.total_ends ?? 6,
    arrows_per_end: last?.arrows_per_end ?? 6,
    target_face_id: last?.target_face_id ?? DEFAULT_TARGET_FACE_ID,
    is_marked: last?.is_marked ?? true,
  };
  return {
    distance,
    operation: {
      type: "distance.created",
      eventId: ids.eventId,
      id: distance.id,
      roundId: ids.roundId,
      positionKey: distance.position_key,
      distance: distance.distance,
      totalEnds: distance.total_ends,
      arrowsPerEnd: distance.arrows_per_end,
      targetFaceId: distance.target_face_id,
      isMarked: distance.is_marked,
    },
  };
}

// 設定の保存で、その距離のマスの構成または得点判定が変わるか。
// 距離（m）とMarked/Unmarkedはマスの構成にも得点判定にも影響しないため、変わらない扱いとする。
// 編集のダイアログは、その距離が状態にある描画の中で開き、距離が消えればカードごと閉じる。変更前の距離が無いときは、変わったとは見なさない。
export function changesDistanceStructure(
  distances: Distance[],
  updated: Distance,
): boolean {
  const previous = distances.find((d) => d.id === updated.id);
  return (
    previous !== undefined &&
    (previous.total_ends !== updated.total_ends ||
      previous.arrows_per_end !== updated.arrows_per_end ||
      previous.target_face_id !== updated.target_face_id)
  );
}

// 保存した値と編集後の値の差分を、操作として返す。差分が無ければ操作を積まない。
// 構成は的・エンド数・矢数の1組で、どれかが変われば3項目全てを送る。
export function buildDistanceUpdatedOperation(
  saved: Distance,
  config: Distance,
  eventId: string,
): SyncOperation | null {
  const changes: DistanceChanges = {};
  if (config.distance !== saved.distance) changes.distance = config.distance;
  if (config.is_marked !== saved.is_marked) changes.isMarked = config.is_marked;
  if (
    config.total_ends !== saved.total_ends ||
    config.arrows_per_end !== saved.arrows_per_end ||
    config.target_face_id !== saved.target_face_id
  ) {
    changes.config = {
      totalEnds: config.total_ends,
      arrowsPerEnd: config.arrows_per_end,
      targetFaceId: config.target_face_id,
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
