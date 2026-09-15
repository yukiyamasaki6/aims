import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  loadPendingOperations,
  removePendingOperation,
  savePendingOperation,
} from "./sync-outbox";

describe("sync outbox", () => {
  it("roundごとに未同期イベントを永続化し、完了後に取り除く", async () => {
    const eventId = crypto.randomUUID();
    const roundId = crypto.randomUUID();
    const otherRoundId = crypto.randomUUID();

    await savePendingOperation({
      eventId,
      roundId,
      key: "roundConfig",
      label: "ラウンド設定",
      operation: {
        type: "round.updated",
        eventId,
        roundId,
        name: "午後練習",
        roundDate: "2026-09-15",
        format: "outdoor",
        bowType: "recurve",
      },
    });
    await savePendingOperation({
      eventId: crypto.randomUUID(),
      roundId: otherRoundId,
      key: "roundConfig",
      label: "別のラウンド設定",
      operation: {
        type: "round.updated",
        eventId: crypto.randomUUID(),
        roundId: otherRoundId,
        name: "別ラウンド",
        roundDate: "2026-09-15",
        format: "outdoor",
        bowType: "recurve",
      },
    });

    expect(await loadPendingOperations(roundId)).toMatchObject([
      { eventId, roundId, key: "roundConfig" },
    ]);

    await removePendingOperation(eventId);
    expect(await loadPendingOperations(roundId)).toEqual([]);
  });
});
