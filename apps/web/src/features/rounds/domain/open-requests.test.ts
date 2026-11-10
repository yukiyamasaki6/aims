import { describe, expect, it } from "vitest";
import {
  beginOpenRun,
  EMPTY_OPEN_REQUESTS,
  type OpenRequests,
  requestOpen,
  settleOpenRun,
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
  it("依頼を受けると番号が進み、待ちに足され、見つからなかった記録が消える", () => {
    // Given
    const first = requestOpen(EMPTY_OPEN_REQUESTS, "r-1").state;
    const recorded = settleOpenRun(
      first,
      beginOpenRun(first, "r-1"),
      true,
    ).state;
    const before = recorded.get("r-1");

    // When
    const next = requestOpen(recorded, "r-1");

    // Then
    expect(next.request).toBe(2);
    expect(next.state.get("r-1")).toMatchObject({
      latest: 2,
      waiting: [2],
      gone: false,
    });
    expect(recorded.get("r-1")).toBe(before);
    expect(recorded.get("r-1")?.gone).toBe(true);
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
  it("待っている依頼を答える依頼として控え、状態は変えない", () => {
    // Given
    const state = requested(EMPTY_OPEN_REQUESTS, "r-1");

    // When
    const run = beginOpenRun(state, "r-1");

    // Then
    expect(run.answers).toEqual([1]);
    expect(run.roundId).toBe("r-1");
    expect(state.get("r-1")?.waiting).toEqual([1]);
  });

  it("依頼の後すぐ2つ目の実行を始めると、答える依頼は両方とも同じで、別の実行として区別される", () => {
    // Given
    const state = requested(EMPTY_OPEN_REQUESTS, "r-1");
    const first = beginOpenRun(state, "r-1");

    // When
    const second = beginOpenRun(state, "r-1");

    // Then
    expect(second).not.toBe(first);
    expect(first.answers).toEqual([1]);
    expect(second.answers).toEqual([1]);
  });

  it("依頼が無い実行は、答える依頼を持たない", () => {
    // Given
    // When
    const run = beginOpenRun(EMPTY_OPEN_REQUESTS, "r-1");

    // Then
    expect(run.answers).toEqual([]);
  });
});

describe("settleOpenRun", () => {
  it("実行が終わると、見つからなかったかを記録し、答える依頼を返し、変化を知らせる", () => {
    // Given
    const state = requested(EMPTY_OPEN_REQUESTS, "r-1");
    const run = beginOpenRun(state, "r-1");

    // When
    const result = settleOpenRun(state, run, true);

    // Then
    expect(result.state.get("r-1")?.gone).toBe(true);
    expect(result.answered).toEqual([1]);
    expect(result.state.get("r-1")?.waiting).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it("見つからなかったかは、最後に終わった実行の結果になる。答える依頼は1回だけ解決する", () => {
    // Given
    const state = requested(EMPTY_OPEN_REQUESTS, "r-1");
    const a = beginOpenRun(state, "r-1");
    const b = beginOpenRun(state, "r-1");

    // When
    const afterB = settleOpenRun(state, b, false);
    const afterA = settleOpenRun(afterB.state, a, true);

    // Then
    expect(afterB.answered).toEqual([1]);
    expect(afterB.state.get("r-1")?.gone).toBe(false);
    expect(afterA.answered).toEqual([]);
    expect(afterA.state.get("r-1")?.gone).toBe(true);
    expect(afterA.changed).toBe(true);
  });

  it("記録済みと同じ結果で終わり、答える依頼も無いときは、何も変えず変化を知らせない", () => {
    // Given
    const first = beginOpenRun(EMPTY_OPEN_REQUESTS, "r-1");
    const recorded = settleOpenRun(EMPTY_OPEN_REQUESTS, first, false).state;
    const second = beginOpenRun(recorded, "r-1");

    // When
    const result = settleOpenRun(recorded, second, false);

    // Then
    expect(result.changed).toBe(false);
    expect(result.answered).toEqual([]);
    expect(result.state).toBe(recorded);
  });

  it("記録済みと違う結果で終わると、記録を更新して変化を知らせる", () => {
    // Given
    const state = requested(EMPTY_OPEN_REQUESTS, "r-1");
    const recorded = settleOpenRun(
      state,
      beginOpenRun(state, "r-1"),
      false,
    ).state;
    const run = beginOpenRun(recorded, "r-1");

    // When
    const result = settleOpenRun(recorded, run, true);

    // Then
    expect(result.changed).toBe(true);
    expect(result.state.get("r-1")?.gone).toBe(true);
  });

  it("新しい依頼が来た後は、先に始めた実行は新しい依頼を答えず、新しい依頼は待ちに残る", () => {
    // Given
    const state = requested(EMPTY_OPEN_REQUESTS, "r-1");
    const run = beginOpenRun(state, "r-1");
    const withNew = requestOpen(state, "r-1").state;

    // When
    const result = settleOpenRun(withNew, run, false);

    // Then
    expect(result.answered).toEqual([1]);
    expect(result.state.get("r-1")?.waiting).toEqual([2]);
  });
});
