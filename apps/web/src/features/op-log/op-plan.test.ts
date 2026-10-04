import { describe, expect, it } from "vitest";
import type { OpPlanPorts, OpStatus, PlanItem } from "./op-log-types";
import { planFlights } from "./op-plan";

// kindが"a"と"b"はlane "record"と"clear"、"s"は直列。targetが同じ組だけ衝突する。
type Op = { eventId: string; kind: "a" | "b" | "s"; target: string };

const ports: OpPlanPorts<Op> = {
  conflicts: (previous, next) =>
    previous.target === next.target ||
    previous.kind === "s" ||
    next.kind === "s",
  laneOf: (op) =>
    op.kind === "a" ? "record" : op.kind === "b" ? "clear" : "serial",
  batchLimitOf: (lane) => (lane === "serial" ? 1 : 3),
};

function item(
  eventId: string,
  kind: Op["kind"],
  target: string,
  status: OpStatus = "queued",
  solo = false,
  sendable = true,
): PlanItem<Op> {
  return {
    eventId,
    operation: { eventId, kind, target },
    status,
    solo,
    sendable,
  };
}

function ids(flights: ReturnType<typeof planFlights<Op>>) {
  return flights.map((f) => f.entries.map((e) => e.eventId));
}

describe("planFlights", () => {
  it("衝突しない操作は、列の順に1本の要求へまとめる", () => {
    const flights = planFlights(
      [item("1", "a", "x"), item("2", "a", "y"), item("3", "a", "z")],
      ports,
    );

    expect(ids(flights)).toEqual([["1", "2", "3"]]);
  });

  it("衝突する前の操作が同じ要求の中にあれば、同じ要求へ順に入れる", () => {
    const flights = planFlights(
      [item("1", "a", "x"), item("2", "a", "x")],
      ports,
    );

    expect(ids(flights)).toEqual([["1", "2"]]);
  });

  it("別のlaneで衝突する前の操作は、確定するまで後続を計画に出さない", () => {
    const flights = planFlights(
      [item("1", "a", "x"), item("2", "b", "x"), item("3", "b", "y")],
      ports,
    );

    expect(ids(flights)).toEqual([["1"], ["3"]]);
  });

  it.each(["inflight", "backoff", "held", "persisting"] as const)(
    "前の操作が%sの間は、同じ対象の後続を出さず、別の対象は出す",
    (status) => {
      const flights = planFlights(
        [item("1", "b", "x", status), item("2", "a", "x"), item("3", "a", "y")],
        ports,
      );

      expect(ids(flights)).toEqual([["3"]]);
    },
  );

  it("前の操作が確定済みなら、後続を止めない", () => {
    const flights = planFlights(
      [item("1", "b", "x", "acked"), item("2", "a", "x")],
      ports,
    );

    expect(ids(flights)).toEqual([["2"]]);
  });

  it("応答待ちの要求があるlaneには新しい要求を出さない", () => {
    const flights = planFlights(
      [
        item("1", "a", "x", "inflight"),
        item("2", "a", "y"),
        item("3", "b", "z"),
      ],
      ports,
    );

    expect(ids(flights)).toEqual([["3"]]);
  });

  it("リトライ待機の要求は、laneを占めない", () => {
    const flights = planFlights(
      [item("1", "a", "x", "backoff"), item("2", "a", "y")],
      ports,
    );

    expect(ids(flights)).toEqual([["2"]]);
  });

  it("要求の上限を超えた分は次の要求に回す", () => {
    const flights = planFlights(
      ["1", "2", "3", "4"].map((id) => item(id, "a", id)),
      ports,
    );

    expect(ids(flights)).toEqual([["1", "2", "3"]]);
  });

  it("直列のlaneは1件ずつで、前の操作が衝突する間は出さない", () => {
    const flights = planFlights(
      [item("1", "s", "x"), item("2", "s", "y"), item("3", "a", "z")],
      ports,
    );

    expect(ids(flights)).toEqual([["1"]]);
  });

  it("単独にする操作は、ほかの操作と同じ要求に入れない", () => {
    const flights = planFlights(
      [item("1", "a", "x", "queued", true), item("2", "a", "y")],
      ports,
    );

    expect(ids(flights)).toEqual([["1"]]);
  });

  it("単独の操作の前に別の操作がある場合、先に束だけを出す", () => {
    const flights = planFlights(
      [item("1", "a", "x"), item("2", "a", "y", "queued", true)],
      ports,
    );

    expect(ids(flights)).toEqual([["1"]]);
  });

  describe("矢のlaneを距離ごとに分けるとき", () => {
    // targetの先頭2文字を距離として、"a"は"record:<距離>"、"b"は"clear:<距離>"のlaneにする。
    const perDistance: OpPlanPorts<Op> = {
      conflicts: (previous, next) => previous.target === next.target,
      laneOf: (op) =>
        op.kind === "s"
          ? "serial"
          : `${op.kind === "a" ? "record" : "clear"}:${op.target.slice(0, 2)}`,
      batchLimitOf: (lane) => (lane === "serial" ? 1 : 2),
    };

    it("距離ごとに別の要求にし、1要求に2距離を入れない", () => {
      const flights = planFlights(
        [item("1", "a", "d1x"), item("2", "a", "d2x"), item("3", "a", "d1y")],
        perDistance,
      );

      expect(ids(flights)).toEqual([["1", "3"], ["2"]]);
    });

    it("同じ距離の記録と取り消しも、別の要求にする", () => {
      const flights = planFlights(
        [item("1", "a", "d1x"), item("2", "b", "d1y")],
        perDistance,
      );

      expect(ids(flights)).toEqual([["1"], ["2"]]);
    });

    it("ある距離のlaneが応答待ちでも、別の距離は同時に応答待ちにでき、同じlaneは1本までにする", () => {
      const flights = planFlights(
        [
          item("1", "a", "d1x", "inflight"),
          item("2", "a", "d1y"),
          item("3", "a", "d2x"),
        ],
        perDistance,
      );

      expect(ids(flights)).toEqual([["3"]]);
    });

    it("距離の上限を超えた分は、同じ距離の次の要求に回す", () => {
      const flights = planFlights(
        ["1", "2", "3"].map((id) => item(id, "a", `d1${id}`)),
        perDistance,
      );

      expect(ids(flights)).toEqual([["1", "2"]]);
    });
  });

  it("送れない`queued`の操作は候補にならず、laneを占有しない", () => {
    const flights = planFlights(
      [item("1", "a", "x", "queued", false, false), item("2", "a", "y")],
      ports,
    );

    expect(ids(flights)).toEqual([["2"]]);
  });

  it("送れない操作も、未確定であれば衝突する後続を止める", () => {
    const flights = planFlights(
      [item("1", "a", "x", "queued", false, false), item("2", "a", "x")],
      ports,
    );

    expect(ids(flights)).toEqual([]);
  });
});
