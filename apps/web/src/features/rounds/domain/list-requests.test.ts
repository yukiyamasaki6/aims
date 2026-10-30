import { describe, expect, it } from "vitest";
import {
  beginListRun,
  decideList,
  EMPTY_LIST_REQUESTS,
  type ListRequests,
  type ListRun,
  listVerdict,
  requestList,
  settleListRun,
  stopLists,
} from "./list-requests";

function requested(times: number) {
  let state: ListRequests = EMPTY_LIST_REQUESTS;
  for (let i = 0; i < times; i += 1) state = requestList(state).state;
  return state;
}

describe("requestList", () => {
  it("依頼を受けるたびに番号が進み、待ちに足される。成否は決まるまでnull", () => {
    // Given
    // When
    const first = requestList(EMPTY_LIST_REQUESTS);
    const second = requestList(first.state);

    // Then
    expect([first.request, second.request]).toEqual([1, 2]);
    expect(second.state.latest).toBe(2);
    expect(second.state.pending).toEqual([1, 2]);
    expect(second.state.decisions.get(1)).toBeNull();
  });
});

describe("decideList", () => {
  it("解決していない依頼にだけ成否を書き、知らない番号、解決した依頼、停止の後の依頼では状態を変えない", () => {
    // Given
    const state = requested(1);

    // When
    const decided = decideList(state, 1, true);
    const unknown = decideList(state, 99, true);
    const { state: running, run } = beginListRun(state);
    const settled = settleListRun(running, run).state;
    const afterSettle = decideList(settled, 1, false);
    const afterStop = decideList(stopLists(state).state, 1, true);

    // Then
    expect(decided.decisions.get(1)).toBe(true);
    expect(unknown).toBe(state);
    expect(afterSettle).toBe(settled);
    expect(afterStop).toEqual(stopLists(state).state);
  });
});

describe("beginListRun", () => {
  it("始めた時点で待っている依頼だけを含み、後から来た依頼は次の実行に含まれる", () => {
    // Given
    const first = beginListRun(requested(1));

    // When
    const withSecond = requestList(first.state).state;
    const second = beginListRun(withSecond);

    // Then
    expect(first.run.requests).toEqual([1]);
    expect(second.run.requests).toEqual([2]);
    expect(first.state.pending).toEqual([]);
    expect(withSecond.pending).toEqual([2]);
    expect(second.state.pending).toEqual([]);
    expect(second.run).not.toBe(first.run);
  });
});

describe("listVerdict", () => {
  it.each([
    [[null, null], "undecided"],
    [[true, null], "allowed"],
    [[null, true], "allowed"],
    [[false, null], "undecided"],
    [[false, false], "denied"],
    [[true, false], "allowed"],
  ] as const)(
    "含めた2つの依頼の成否が%sなら、判定は%sになる",
    (decisions, expected) => {
      // Given
      const { state, run } = beginListRun(requested(2));
      const decided = decisions.reduce<ListRequests>(
        (current, ok, index) =>
          ok === null ? current : decideList(current, index + 1, ok),
        state,
      );

      // When
      const verdict = listVerdict(decided, run);

      // Then
      expect(verdict).toBe(expected);
    },
  );

  it("含めた依頼が無い実行、生きていない実行(始めていない、終わった、停止した)は拒否になる", () => {
    // Given
    const empty = beginListRun(EMPTY_LIST_REQUESTS);
    const notStarted: ListRun = { requests: [] };
    const started = beginListRun(requested(1));
    const settled = settleListRun(started.state, started.run).state;
    const stopped = stopLists(started.state).state;

    // When
    const verdicts = [
      listVerdict(empty.state, empty.run),
      listVerdict(EMPTY_LIST_REQUESTS, notStarted),
      listVerdict(settled, started.run),
      listVerdict(stopped, started.run),
    ];

    // Then
    expect(verdicts).toEqual(["denied", "denied", "denied", "denied"]);
  });
});

describe("settleListRun", () => {
  it("含めた依頼を解決する依頼として返し、成否と実行を片付ける。実行の後に来た依頼は待ちに残る", () => {
    // Given
    const { state, run } = beginListRun(requested(2));
    const decided = decideList(state, 1, true);
    const withLater = requestList(decided).state;

    // When
    const result = settleListRun(withLater, run);

    // Then
    expect(result.answered).toEqual([1, 2]);
    expect(result.state.decisions.has(1)).toBe(false);
    expect(result.state.decisions.has(2)).toBe(false);
    expect(listVerdict(result.state, run)).toBe("denied");
    expect(result.state.pending).toEqual([3]);
  });
});

describe("stopLists", () => {
  it("待っている依頼と実行に含めた依頼の全てを解決する依頼として返し、成否と実行を空にする。番号は残す", () => {
    // Given
    const included = beginListRun(requested(1));
    const state = requestList(included.state).state;

    // When
    const stopped = stopLists(state);
    const next = requestList(stopped.state);

    // Then
    expect([...stopped.answered].sort()).toEqual([1, 2]);
    expect(stopped.state.pending).toEqual([]);
    expect(stopped.state.decisions.size).toBe(0);
    expect(stopped.state.runs.size).toBe(0);
    expect(stopped.state.latest).toBe(2);
    expect(next.request).toBe(3);
  });
});
