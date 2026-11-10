import { describe, expect, it } from "vitest";
import { planFlights } from "./op-plan";
import { laneOf } from "./round-op-conflicts";
import {
  distanceUpdated,
  shotCleared,
  shotRecorded,
} from "./round-op-test-helpers";
import type { PlanItem } from "./send-queue";
import type { SyncOperation } from "./sync-events";

// 矢の操作は、eventIdと同じ名前の矢で、エンドを指定して作る。異なるエンドの矢は衝突しない。
const record = (id: string, distanceId: string, endNumber: number) =>
  shotRecorded({ eventId: id, shotId: id, distanceId, endNumber });
const clear = (id: string, distanceId: string, endNumber: number) =>
  shotCleared({ eventId: id, shotId: id, distanceId, endNumber });
const updateDistance = (id: string, distanceId: string) =>
  distanceUpdated({ eventId: id, distanceId });

function item(
  operation: SyncOperation,
  status: PlanItem["status"] = "queued",
  options: { solo?: boolean; sendable?: boolean } = {},
): PlanItem {
  return {
    eventId: operation.eventId,
    operation,
    lane: laneOf(operation),
    status,
    solo: options.solo ?? false,
    sendable: options.sendable ?? true,
  };
}

function ids(flights: ReturnType<typeof planFlights>) {
  return flights.map((flight) => flight.eventIds);
}

describe("planFlights", () => {
  it("衝突しない操作は、列の順に1本の要求へまとめる", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1)),
      item(record("2", "d-1", 2)),
      item(record("3", "d-1", 3)),
    ]);

    // Then
    expect(ids(flights)).toEqual([["1", "2", "3"]]);
  });

  it("衝突する前の操作が同じ要求の中にあれば、同じ要求へ順に入れる", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1)),
      item(record("2", "d-1", 1)),
    ]);

    // Then
    expect(ids(flights)).toEqual([["1", "2"]]);
  });

  it("別のlaneで衝突する前の操作は、確定するまで後続を計画に出さない", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1)),
      item(clear("2", "d-1", 1)),
      item(clear("3", "d-1", 3)),
    ]);

    // Then
    expect(ids(flights)).toEqual([["1"], ["3"]]);
  });

  it.each(["inflight", "backoff", "held", "persisting"] as const)(
    "前の操作が%sの間は、同じ矢の後続を出さず、別のエンドの矢は出す",
    (status) => {
      // Given
      const previous = item(clear("1", "d-1", 1), status);

      // When
      const flights = planFlights([
        previous,
        item(record("1x", "d-1", 1)),
        item(record("3", "d-1", 3)),
      ]);

      // Then
      expect(ids(flights)).toEqual([["3"]]);
    },
  );

  it("応答待ちの要求があるlaneには新しい要求を出さない", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1), "inflight"),
      item(record("2", "d-1", 2)),
      item(clear("3", "d-1", 3)),
    ]);

    // Then
    expect(ids(flights)).toEqual([["3"]]);
  });

  it("リトライ待機の要求は、laneを占めない", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1), "backoff"),
      item(record("2", "d-1", 2)),
    ]);

    // Then
    expect(ids(flights)).toEqual([["2"]]);
  });

  it("矢のlaneは距離ごとに別の要求にし、1要求に2距離を入れない", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1)),
      item(record("2", "d-2", 1)),
      item(record("3", "d-1", 2)),
    ]);

    // Then
    expect(ids(flights)).toEqual([["1", "3"], ["2"]]);
  });

  it("同じ距離の記録と取り消しも、別の要求にする", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1)),
      item(clear("2", "d-1", 2)),
    ]);

    // Then
    expect(ids(flights)).toEqual([["1"], ["2"]]);
  });

  it("ある距離のlaneが応答待ちでも、別の距離は同時に応答待ちにでき、同じlaneは1本までにする", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1), "inflight"),
      item(record("2", "d-1", 2)),
      item(record("3", "d-2", 1)),
    ]);

    // Then
    expect(ids(flights)).toEqual([["3"]]);
  });

  // 上限の値(100件)そのものが検証の対象で、1距離の矢の数が上限に達する形は実際には起こらない。
  it("矢のlaneは100件までで、超えた分は同じ距離の次の要求に回し、別の距離は影響しない", () => {
    // Given
    const arrows = Array.from({ length: 101 }, (_, index) =>
      item(record(`s${index}`, "d-1", index)),
    );

    // When
    const flights = planFlights([...arrows, item(record("other", "d-2", 1))]);

    // Then
    expect(flights.map((flight) => flight.eventIds.length)).toEqual([100, 1]);
    expect(flights[0].eventIds).not.toContain("s100");
    expect(flights[1].eventIds).toEqual(["other"]);
  });

  it("直列のlaneは1件ずつで、前の操作が衝突する間は出さない", () => {
    // Given
    // When
    const flights = planFlights([
      item(updateDistance("1", "d-1")),
      item(updateDistance("2", "d-2")),
      item(record("3", "d-1", 1)),
    ]);

    // Then
    expect(ids(flights)).toEqual([["1"]]);
  });

  it("単独にする操作は、ほかの操作と同じ要求に入れない", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1), "queued", { solo: true }),
      item(record("2", "d-1", 2)),
    ]);

    // Then
    expect(ids(flights)).toEqual([["1"]]);
  });

  it("単独の操作の前に別の操作がある場合、先に束だけを出す", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1)),
      item(record("2", "d-1", 2), "queued", { solo: true }),
    ]);

    // Then
    expect(ids(flights)).toEqual([["1"]]);
  });

  it("送れない`queued`の操作は候補にならず、laneを占有しない", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1), "queued", { sendable: false }),
      item(record("2", "d-1", 2)),
    ]);

    // Then
    expect(ids(flights)).toEqual([["2"]]);
  });

  it("送れない操作も、未確定であれば衝突する後続を止める", () => {
    // Given
    // When
    const flights = planFlights([
      item(record("1", "d-1", 1), "queued", { sendable: false }),
      item(record("2", "d-1", 1)),
    ]);

    // Then
    expect(ids(flights)).toEqual([]);
  });
});
