import type {
  EnqueueShotInput,
  ShotBatch,
  ShotClear,
  ShotUpsert,
} from "./sync-queue-types";

export function distanceIdOf(input: EnqueueShotInput): string | undefined {
  return input.upsert?.distanceId ?? input.clear?.distanceId;
}

// リトライ時点で既に新しい値が積まれているkeyは古い値を送らず除外する。
// 新しい値は現在のバッチ・次の再帰flushで別途送られる。
export function excludeSuperseded(
  pending: EnqueueShotInput[],
  currentBatch: ReadonlyMap<string, EnqueueShotInput> | undefined,
): EnqueueShotInput[] {
  return pending.filter((item) => !currentBatch?.has(item.key));
}

export function toShotBatch(items: EnqueueShotInput[]): ShotBatch {
  return {
    upsert: items
      .map((i) => i.upsert)
      .filter((s): s is ShotUpsert => s !== undefined),
    clear: items
      .map((i) => i.clear)
      .filter((s): s is ShotClear => s !== undefined),
  };
}
