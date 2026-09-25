import type { DistanceConfig } from "./distance-config";
import { compareDistancePosition } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";
import type { EnqueueInput } from "./sync-queue-types";

// 10点的（アウトドア・122cm）。
// 距離が1件も無い状態で追加する距離の的として使う（e2eのcreate-round APIヘルパーが使う既定の的と同じもの）。
const DEFAULT_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001";

// 距離の設定のうち、画面で編集できる項目。
type DistanceSettings = Pick<
  DistanceConfig,
  "distance" | "totalEnds" | "arrowsPerEnd" | "targetFaceId" | "isMarked"
>;

// 追加する距離と、その作成を送信キューへ積む入力を返す。
// 並び順で最後の距離の内容を引き継ぎ、距離が1件も無い場合は既定の内容にする。
// 最後の距離の距離（m）が未設定の場合は、距離（m）だけ既定の値にする。
// IDは楽観的UIのため呼び出し側で確定したものを使う。
export function distanceToAdd(
  distances: Distance[],
  ids: { id: string; eventId: string; roundId: string },
): { distance: Distance; enqueueInput: EnqueueInput } {
  const last = [...distances].sort(compareDistancePosition).at(-1);
  const distance: Distance = {
    id: ids.id,
    position_key: last ? `${last.position_key}a` : "a",
    distance: last?.distance ?? 70,
    total_ends: last?.total_ends ?? 6,
    arrows_per_end: last?.arrows_per_end ?? 6,
    target_face_id: last?.target_face_id ?? DEFAULT_TARGET_FACE_ID,
    is_marked: last?.is_marked ?? true,
  };
  return {
    distance,
    enqueueInput: {
      key: `distance:${distance.id}`,
      label: `距離${distances.length + 1}`,
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
    },
  };
}

// 指定した距離の設定を置き換える。
export function updateDistance(
  distances: Distance[],
  distanceId: string,
  settings: DistanceSettings,
): Distance[] {
  return distances.map((d) =>
    d.id === distanceId
      ? {
          ...d,
          distance: settings.distance,
          total_ends: settings.totalEnds,
          arrows_per_end: settings.arrowsPerEnd,
          target_face_id: settings.targetFaceId,
          is_marked: settings.isMarked,
        }
      : d,
  );
}

// 設定の保存で、その距離のマスの構成または得点判定が変わるか。
// 距離（m）とMarked/Unmarkedはマスの構成にも得点判定にも影響しないため、変わらない扱いとする。
// 変更前の距離が見つからない場合は、変わったものとして扱う。
export function changesDistanceStructure(
  distances: Distance[],
  config: DistanceConfig,
): boolean {
  const previous = distances.find((d) => d.id === config.id);
  return (
    !previous ||
    previous.total_ends !== config.totalEnds ||
    previous.arrows_per_end !== config.arrowsPerEnd ||
    previous.target_face_id !== config.targetFaceId
  );
}

export function removeDistance(
  distances: Distance[],
  distanceId: string,
): Distance[] {
  return distances.filter((d) => d.id !== distanceId);
}

// 削除した距離の記録を取り除く。
export function removeDistanceShots(shots: Shot[], distanceId: string): Shot[] {
  return shots.filter((s) => s.distance_id !== distanceId);
}
