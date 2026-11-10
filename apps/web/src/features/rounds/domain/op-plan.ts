import { batchLimitOf, conflicts } from "./round-op-conflicts";
import type { PlanItem, PlannedFlight } from "./send-queue";

// 衝突する前の操作が、すでに同じ要求に入っているときだけ、操作を要求へ入れてよい。確定済みの操作は計画の入力に無い。
function isBlocked(
  items: readonly PlanItem[],
  index: number,
  chosen: ReadonlySet<string>,
): boolean {
  const next = items[index];
  for (let i = 0; i < index; i++) {
    const previous = items[i];
    if (chosen.has(previous.eventId)) continue;
    if (conflicts(previous.operation, next.operation)) return true;
  }
  return false;
}

// 列（`seq`順）から、いま送れる要求の一覧を返す純粋な関数。
// laneごとに応答待ちの要求は1本までで、候補は`queued`で送ってよい操作だけである。ラウンドの矢のlaneは距離ごとで、異なる距離の要求は並行して送る。
export function planFlights(items: readonly PlanItem[]): PlannedFlight[] {
  const busy = busyLanes(items);
  const flights: PlannedFlight[] = [];
  for (const lane of candidateLanes(items, busy)) {
    const eventIds = planLane(items, lane);
    if (eventIds.length > 0) flights.push({ lane, eventIds });
  }
  return flights;
}

// 応答待ちの要求があるlane。
function busyLanes(items: readonly PlanItem[]): Set<string> {
  const busy = new Set<string>();
  for (const item of items) {
    if (item.status === "inflight") busy.add(item.lane);
  }
  return busy;
}

// 応答待ちが無く、送ってよい`queued`の操作があるlane(出現順)。
function candidateLanes(
  items: readonly PlanItem[],
  busy: ReadonlySet<string>,
): string[] {
  const lanes: string[] = [];
  for (const item of items) {
    if (item.status !== "queued") continue;
    if (!busy.has(item.lane) && !lanes.includes(item.lane)) {
      lanes.push(item.lane);
    }
  }
  return lanes;
}

// 1つのlaneの要求に入れる操作。
function planLane(items: readonly PlanItem[], lane: string): string[] {
  const limit = batchLimitOf(lane);
  const chosen = new Set<string>();
  const eventIds: string[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.status !== "queued" || item.lane !== lane) continue;
    if (eventIds.length >= limit) break;
    // 単独にする操作は、ほかの操作と同じ要求に入れない。
    if (item.solo && eventIds.length > 0) continue;
    if (isBlocked(items, index, chosen)) continue;
    chosen.add(item.eventId);
    eventIds.push(item.eventId);
    if (item.solo || limit === 1) break;
  }
  return eventIds;
}
