import type {
  OpBase,
  OpFlight,
  OpPlanPorts,
  OpStatus,
  PlanItem,
} from "./op-log-types";

// 衝突する前の操作が`acked`か、すでに同じ要求に入っているときだけ、操作を要求へ入れてよい。
function isBlocked<Op extends OpBase>(
  items: PlanItem<Op>[],
  index: number,
  inFlight: Set<string>,
  ports: OpPlanPorts<Op>,
): boolean {
  const next = items[index].operation;
  for (let i = 0; i < index; i++) {
    const previous = items[i];
    if (previous.status === "acked") continue;
    if (inFlight.has(previous.eventId)) continue;
    if (ports.conflicts(previous.operation, next)) return true;
  }
  return false;
}

const BUSY: OpStatus = "inflight";

// 列（`seq`順）から、いま送れる要求の一覧を返す純粋な関数。
// laneごとに応答待ちの要求は1本までで、候補は`queued`の操作だけである。ラウンドの矢のlaneは距離ごとで、異なる距離の要求は並行して送る。
export function planFlights<Op extends OpBase>(
  items: PlanItem<Op>[],
  ports: OpPlanPorts<Op>,
): OpFlight<Op>[] {
  const busyLanes = new Set<string>();
  for (const item of items) {
    if (item.status === BUSY) busyLanes.add(ports.laneOf(item.operation));
  }

  const lanes: string[] = [];
  for (const item of items) {
    if (item.status !== "queued") continue;
    const lane = ports.laneOf(item.operation);
    if (!busyLanes.has(lane) && !lanes.includes(lane)) lanes.push(lane);
  }

  const flights: OpFlight<Op>[] = [];
  for (const lane of lanes) {
    const limit = Math.max(1, ports.batchLimitOf(lane));
    const chosen = new Set<string>();
    const entries: OpFlight<Op>["entries"] = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.status !== "queued" || ports.laneOf(item.operation) !== lane) {
        continue;
      }
      if (entries.length >= limit) break;
      // 単独にする操作は、ほかの操作と同じ要求に入れない。
      if (item.solo && entries.length > 0) continue;
      if (isBlocked(items, index, chosen, ports)) continue;
      chosen.add(item.eventId);
      entries.push({ eventId: item.eventId, operation: item.operation });
      if (item.solo || limit === 1) break;
    }
    if (entries.length > 0) flights.push({ lane, entries });
  }
  return flights;
}
