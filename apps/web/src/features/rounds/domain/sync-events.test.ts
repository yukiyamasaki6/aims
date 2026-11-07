import { describe, expect, it } from "vitest";
import {
  distanceCreated,
  roundDisabled,
  roundUpdated,
} from "./round-op-test-helpers";
import {
  hasRoundDeletion,
  roundIdOfStream,
  roundStreamId,
} from "./sync-events";

describe("hasRoundDeletion", () => {
  it("ラウンドの削除を含む列は真、含まない列は偽になる", () => {
    // Given

    // When
    const withDeletion = hasRoundDeletion([roundUpdated(), roundDisabled()]);
    const withoutDeletion = hasRoundDeletion([
      roundUpdated(),
      distanceCreated(),
    ]);
    const empty = hasRoundDeletion([]);

    // Then
    expect(withDeletion).toBe(true);
    expect(withoutDeletion).toBe(false);
    expect(empty).toBe(false);
  });
});

describe("列のID", () => {
  it("ラウンドIDから作った列のIDは、元のラウンドIDに戻せる", () => {
    // Given

    // When
    const streamId = roundStreamId("round-1");

    // Then
    expect(streamId).toBe("round:round-1");
    expect(roundIdOfStream(streamId)).toBe("round-1");
  });
});
