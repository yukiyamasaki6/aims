import type { PlanItem, PlannedFlight } from "./send-queue";

// 計画が問う、操作の関係。操作の意味はラウンドが持ち、計画は操作のIDで問う。
export type OpPlanPorts = {
  // 前の操作と後の操作が、適用順で結果が変わる、または検証が順序に依存するとき真。
  conflicts: (previousEventId: string, nextEventId: string) => boolean;
  // 1つの要求にまとめてよいlaneと、その上限。無ければ1件だけの要求にする。
  batchLimitOf: (lane: string) => number;
};

// 衝突する前の操作が`acked`か、すでに同じ要求に入っているときだけ、操作を要求へ入れてよい。
function isBlocked(
  items: readonly PlanItem[],
  index: number,
  chosen: ReadonlySet<string>,
  ports: OpPlanPorts,
): boolean {
  const next = items[index];
  for (let i = 0; i < index; i++) {
    const previous = items[i];
    if (previous.status === "acked") continue;
    if (chosen.has(previous.eventId)) continue;
    if (ports.conflicts(previous.eventId, next.eventId)) return true;
  }
  return false;
}

// 列（`seq`順）から、いま送れる要求の一覧を返す純粋な関数。
// laneごとに応答待ちの要求は1本までで、候補は`queued`で送ってよい操作だけである。ラウンドの矢のlaneは距離ごとで、異なる距離の要求は並行して送る。
export function planFlights(
  items: readonly PlanItem[],
  ports: OpPlanPorts,
): PlannedFlight[] {
  const busy = busyLanes(items);
  const flights: PlannedFlight[] = [];
  for (const lane of candidateLanes(items, busy)) {
    const eventIds = planLane(items, lane, ports);
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
    if (item.status !== "queued" || !item.sendable) continue;
    if (!busy.has(item.lane) && !lanes.includes(item.lane)) {
      lanes.push(item.lane);
    }
  }
  return lanes;
}

// 1つのlaneの要求に入れる操作。
function planLane(
  items: readonly PlanItem[],
  lane: string,
  ports: OpPlanPorts,
): string[] {
  const limit = Math.max(1, ports.batchLimitOf(lane));
  const chosen = new Set<string>();
  const eventIds: string[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.status !== "queued" || !item.sendable || item.lane !== lane) {
      continue;
    }
    if (eventIds.length >= limit) break;
    // 単独にする操作は、ほかの操作と同じ要求に入れない。
    if (item.solo && eventIds.length > 0) continue;
    if (isBlocked(items, index, chosen, ports)) continue;
    chosen.add(item.eventId);
    eventIds.push(item.eventId);
    if (item.solo || limit === 1) break;
  }
  return eventIds;
}
