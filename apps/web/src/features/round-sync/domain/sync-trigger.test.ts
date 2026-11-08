import { describe, expect, it } from "vitest";
import { shouldRefetch } from "./sync-trigger";

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
