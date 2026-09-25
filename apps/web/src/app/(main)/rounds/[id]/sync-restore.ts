import type { PendingSyncOperation } from "./sync-outbox";
import type { RestoredInput } from "./sync-queue-types";

// 依存先がまだ残っていない操作から順に並べる。
// 循環や依存先の欠落で該当する操作がない場合は、先頭から取り出して処理を止めない。
export function orderByDependency(
  operations: PendingSyncOperation[],
): PendingSyncOperation[] {
  const remaining = [...operations];
  const ordered: PendingSyncOperation[] = [];
  while (remaining.length > 0) {
    const index = remaining.findIndex(
      (pending) =>
        !pending.dependsOnKey ||
        !remaining.some((other) => other.key === pending.dependsOnKey),
    );
    ordered.push(...remaining.splice(index === -1 ? 0 : index, 1));
  }
  return ordered;
}

export function toRestoredInput(pending: PendingSyncOperation): RestoredInput {
  const base = {
    key: pending.key,
    label: pending.label,
    dependsOnKey: pending.dependsOnKey,
    restored: true,
  };
  const { operation } = pending;
  switch (operation.type) {
    case "shot.recorded":
      return {
        type: "shot",
        input: {
          ...base,
          operation,
          upsert: {
            shotEventId: operation.eventId,
            distanceId: operation.distanceId,
            endNumber: operation.endNumber,
            arrowNumber: operation.arrowNumber,
            shooterId: operation.shooterId,
            scoreStr: operation.scoreStr,
            scoreInt: operation.scoreInt,
          },
        },
      };
    case "shot.cleared":
      return {
        type: "shot",
        input: {
          ...base,
          operation,
          clear: {
            shotEventId: operation.eventId,
            distanceId: operation.distanceId,
            endNumber: operation.endNumber,
            arrowNumber: operation.arrowNumber,
          },
        },
      };
    default:
      return { type: "operation", input: { ...base, operation } };
  }
}
