import { describe, expect, it } from "vitest";
import {
  beginOpenRun,
  EMPTY_OPEN_REQUESTS,
  type OpenRequests,
  requestOpen,
  settleOpenRun,
  stopOpens,
} from "./open-requests";

// 状態を作る補助。依頼を受ける。
function requested(state: OpenRequests, roundId: string, times = 1) {
  let current = state;
  for (let i = 0; i < times; i += 1) {
    current = requestOpen(current, roundId).state;
  }
  return current;
}

describe("requestOpen", () => {
  it("依頼を受けると番号が進み、待ちに足され、結果の記録と記録の権利が消える", () => {
    // Given
    const first = requestOpen(EMPTY_OPEN_REQUESTS, "r-1").state;
    const { state: running, run } = beginOpenRun(first, "r-1");
    const recorded = settleOpenRun(running, run, "ok").state;
    const before = recorded.get("r-1");

    // When
    const next = requestOpen(recorded, "r-1");

    // Then
    expect(next.request).toBe(2);
    expect(next.state.get("r-1")).toMatchObject({
      latest: 2,
      waiting: [2],
      holder: null,
    });
    expect(next.state.get("r-1")?.outcome).toBeUndefined();
    expect(recorded.get("r-1")).toBe(before);
    expect(recorded.get("r-1")?.outcome).toBe("ok");
  });

  it("別のラウンドは番号と状態を共有しない", () => {
    // Given
    const state = requested(requested(EMPTY_OPEN_REQUESTS, "r-1", 2), "r-2");

    // When
    const next = requestOpen(state, "r-2");
    const other = requestOpen(EMPTY_OPEN_REQUESTS, "r-3");

    // Then
    expect(other.request).toBe(1);
    expect(state.get("r-1")?.latest).toBe(2);
    expect(state.get("r-2")?.latest).toBe(1);
    expect(next.request).toBe(2);
  });
});

describe("beginOpenRun", () => {
  it("待っている依頼を答える依頼として控え、記録の権利がその実行へ移る", () => {
    // Given
    const state = requested(EMPTY_OPEN_REQUESTS, "r-1");

    // When
    const { state: running, run } = beginOpenRun(state, "r-1");

    // Then
    expect(run.answers).toEqual([1]);
    expect(run.roundId).toBe("r-1");
    expect(running.get("r-1")?.holder).toBe(run);
  });

  it("依頼の後すぐ2つ目の実行を始めると、権利は2つ目の実行になり、答える依頼は両方とも同じ", () => {
    // Given
    const state = requested(EMPTY_OPEN_REQUESTS, "r-1");
    const first = beginOpenRun(state, "r-1");

    // When
    const second = beginOpenRun(first.state, "r-1");

    // Then
    expect(second.state.get("r-1")?.holder).toBe(second.run);
    expect(second.run).not.toBe(first.run);
    expect(first.run.answers).toEqual([1]);
    expect(second.run.answers).toEqual([1]);
  });

  it("依頼が無い実行も権利を持つ", () => {
    // Given
    // When
    const { state, run } = beginOpenRun(EMPTY_OPEN_REQUESTS, "r-1");

    // Then
    expect(run.answers).toEqual([]);
    expect(state.get("r-1")?.holder).toBe(run);
  });
});

describe("settleOpenRun", () => {
  it("記録の権利を持つ実行が終わると、結果を記録し、答える依頼を返し、変化を知らせる", () => {
    // Given
    const { state, run } = beginOpenRun(
      requested(EMPTY_OPEN_REQUESTS, "r-1"),
      "r-1",
    );

    // When
    const result = settleOpenRun(state, run, "gone");

    // Then
    expect(result.state.get("r-1")?.outcome).toBe("gone");
    expect(result.answered).toEqual([1]);
    expect(result.state.get("r-1")?.waiting).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it("権利を失った実行は結果を記録せず、答える依頼は解決する。権利を持つ実行は後で記録する", () => {
    // Given
    const requestedOnce = requested(EMPTY_OPEN_REQUESTS, "r-1");
    const a = beginOpenRun(requestedOnce, "r-1");
    const b = beginOpenRun(a.state, "r-1");

    // When
    const afterA = settleOpenRun(b.state, a.run, "gone");
    const afterB = settleOpenRun(afterA.state, b.run, "ok");

    // Then
    expect(afterA.state.get("r-1")?.outcome).toBeUndefined();
    expect(afterA.answered).toEqual([1]);
    expect(afterA.changed).toBe(true);
    expect(afterB.state.get("r-1")?.outcome).toBe("ok");
    expect(afterB.answered).toEqual([]);
    expect(afterB.changed).toBe(true);
  });

  it("答える依頼は1回だけ解決し、先に権利を持つ実行が記録した後の古い実行の終わりは何も変えない", () => {
    // Given
    const a = beginOpenRun(requested(EMPTY_OPEN_REQUESTS, "r-1"), "r-1");
    const b = beginOpenRun(a.state, "r-1");
    const afterB = settleOpenRun(b.state, b.run, "ok");

    // When
    const afterA = settleOpenRun(afterB.state, a.run, "gone");

    // Then
    expect(afterB.answered).toEqual([1]);
    expect(afterA.answered).toEqual([]);
    expect(afterA.state.get("r-1")?.outcome).toBe("ok");
    expect(afterA.changed).toBe(false);
    expect(afterA.state.get("r-1")).toBe(afterB.state.get("r-1"));
  });

  it("記録の権利を持つ実行が、記録済みと同じ結果で終わり、答える依頼も無いときは、何も変えず変化を知らせない", () => {
    // Given
    const first = beginOpenRun(EMPTY_OPEN_REQUESTS, "r-1");
    const recorded = settleOpenRun(first.state, first.run, "ok").state;
    const second = beginOpenRun(recorded, "r-1");

    // When
    const result = settleOpenRun(second.state, second.run, "ok");

    // Then
    expect(result.changed).toBe(false);
    expect(result.answered).toEqual([]);
    expect(result.state).toBe(second.state);
  });

  it("記録の権利を持つ実行が、記録済みと違う結果で終わると、記録を更新して変化を知らせる", () => {
    // Given
    const first = beginOpenRun(EMPTY_OPEN_REQUESTS, "r-1");
    const recorded = settleOpenRun(first.state, first.run, "ok").state;
    const second = beginOpenRun(recorded, "r-1");

    // When
    const result = settleOpenRun(second.state, second.run, "failed");

    // Then
    expect(result.changed).toBe(true);
    expect(result.state.get("r-1")?.outcome).toBe("failed");
  });

  it("新しい依頼が来た後は、先に始めた実行の結果を記録せず、新しい依頼は答えない", () => {
    // Given
    const a = beginOpenRun(requested(EMPTY_OPEN_REQUESTS, "r-1"), "r-1");
    const withNew = requestOpen(a.state, "r-1").state;

    // When
    const result = settleOpenRun(withNew, a.run, "ok");

    // Then
    expect(result.state.get("r-1")?.outcome).toBeUndefined();
    expect(result.answered).toEqual([1]);
    expect(result.state.get("r-1")?.waiting).toEqual([2]);
    expect(result.state.get("r-1")?.holder).toBeNull();
  });
});

describe("stopOpens", () => {
  it("全ての待ちを解決する依頼として返し、待ちと記録の権利を空にする。依頼の番号と結果の記録は残す", () => {
    // Given
    const recorded = (() => {
      const { state, run } = beginOpenRun(
        requested(EMPTY_OPEN_REQUESTS, "r-1"),
        "r-1",
      );
      return settleOpenRun(state, run, "ok").state;
    })();
    const r2 = beginOpenRun(requested(recorded, "r-2", 2), "r-2").state;
    const state = requested(r2, "r-3");

    // When
    const stopped = stopOpens(state);

    // Then
    expect(stopped.answered).toHaveLength(3);
    expect(stopped.answered).toEqual(
      expect.arrayContaining([
        { roundId: "r-2", request: 1 },
        { roundId: "r-2", request: 2 },
        { roundId: "r-3", request: 1 },
      ]),
    );
    expect(stopped.state.get("r-2")).toMatchObject({
      waiting: [],
      holder: null,
      latest: 2,
    });
    expect(stopped.state.get("r-3")).toMatchObject({
      waiting: [],
      holder: null,
      latest: 1,
    });
    expect(stopped.state.get("r-1")).toMatchObject({
      latest: 1,
      outcome: "ok",
    });
  });

  it("停止の後に依頼を受けると番号は数え直さず続き、停止前に始めた実行は結果を記録せず何も変えない", () => {
    // Given
    const a = beginOpenRun(requested(EMPTY_OPEN_REQUESTS, "r-1"), "r-1");
    const stopped = stopOpens(a.state).state;
    const next = requestOpen(stopped, "r-1");

    // When
    const result = settleOpenRun(next.state, a.run, "ok");

    // Then
    expect(next.request).toBe(2);
    expect(result.state.get("r-1")?.outcome).toBeUndefined();
    expect(result.answered).toEqual([]);
    expect(result.changed).toBe(false);
  });
});
