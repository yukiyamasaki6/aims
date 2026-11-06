import { describe, expect, it } from "vitest";
import { refreshDecision, shouldRefetch } from "./sync-trigger";

describe("shouldRefetch", () => {
  it("開いたときは常に取り直し、他の理由はオフラインでは取り直さない", () => {
    // Given
    // When
    const open = [true, false].map((offline) => shouldRefetch(true, offline));
    const otherOnline = shouldRefetch(false, false);
    const otherOffline = shouldRefetch(false, true);

    // Then
    expect(open).toEqual([true, true]);
    expect(otherOnline).toBe(true);
    expect(otherOffline).toBe(false);
  });

  it.each([
    { isOpenRequest: true, offline: false, expected: true },
    { isOpenRequest: true, offline: true, expected: true },
    { isOpenRequest: false, offline: false, expected: true },
    { isOpenRequest: false, offline: true, expected: false },
  ])(
    "開く依頼が$isOpenRequest、オフラインが$offlineのとき、取り直しは$expectedになる",
    ({ isOpenRequest, offline, expected }) => {
      // Given
      // When
      const result = shouldRefetch(isOpenRequest, offline);

      // Then
      expect(result).toBe(expected);
    },
  );
});

describe("refreshDecision", () => {
  it("常駐の前段を通らなければ取得しない", () => {
    // Given
    // When
    const decision = refreshDecision({
      kind: "resident",
      residentAllowed: false,
    });

    // Then
    expect(decision).toEqual({ fetch: false, waitForList: false });
  });

  it("常駐の前段を通れば、一覧の成否を待たずに取得する", () => {
    // Given
    // When
    const decision = refreshDecision({
      kind: "resident",
      residentAllowed: true,
    });

    // Then
    expect(decision).toEqual({ fetch: true, waitForList: false });
  });

  it("一覧の依頼は常に取得し、一覧の成否を待つ", () => {
    // Given
    // When
    const decision = refreshDecision({ kind: "list" });

    // Then
    expect(decision).toEqual({ fetch: true, waitForList: true });
  });
});
