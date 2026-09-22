import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
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

    const userId = "user-1";

    await savePendingOperation({
      eventId,
      roundId,
      key: "roundConfig",
      label: "ラウンド設定",
      userId,
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
      userId,
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

    expect(await loadPendingOperations(roundId, userId)).toMatchObject([
      { eventId, roundId, key: "roundConfig" },
    ]);

    await removePendingOperation(eventId);
    expect(await loadPendingOperations(roundId, userId)).toEqual([]);
  });

  it("userIdで絞り込むと、別ユーザーの未同期イベントは対象から除外され、かつ削除もされない", async () => {
    const roundId = crypto.randomUUID();
    const aliceEventId = crypto.randomUUID();
    const bobEventId = crypto.randomUUID();

    await savePendingOperation({
      eventId: aliceEventId,
      roundId,
      userId: "alice",
      key: "roundConfig",
      label: "aliceのラウンド設定",
      operation: {
        type: "round.updated",
        eventId: aliceEventId,
        roundId,
        name: "aliceの練習",
        roundDate: "2026-09-15",
        format: "outdoor",
        bowType: "recurve",
      },
    });
    await savePendingOperation({
      eventId: bobEventId,
      roundId,
      userId: "bob",
      key: "roundConfig",
      label: "bobのラウンド設定",
      operation: {
        type: "round.updated",
        eventId: bobEventId,
        roundId,
        name: "bobの練習",
        roundDate: "2026-09-15",
        format: "outdoor",
        bowType: "recurve",
      },
    });

    // aliceとしてサインインしている間は、bobの未同期レコードは
    // 表示・同期処理の対象から除外される。
    expect(await loadPendingOperations(roundId, "alice")).toMatchObject([
      { eventId: aliceEventId, userId: "alice" },
    ]);

    // 除外されるだけで、削除はされない。後でbobが同じ端末で
    // サインインし直せば、bobの未同期レコードはそのまま復元できる。
    expect(await loadPendingOperations(roundId, "bob")).toMatchObject([
      { eventId: bobEventId, userId: "bob" },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createdAtが同値の場合、eventIdの辞書順でタイブレークする", async () => {
    const roundId = crypto.randomUUID();
    const laterEventId = "zzz-later";
    const earlierEventId = "aaa-earlier";
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);

    await savePendingOperation({
      eventId: laterEventId,
      roundId,
      userId: "user-1",
      key: "roundConfig",
      label: "後で保存したが辞書順は後ろ",
      operation: {
        type: "round.updated",
        eventId: laterEventId,
        roundId,
        name: "practice",
        roundDate: "2026-09-15",
        format: "outdoor",
        bowType: "recurve",
      },
    });
    await savePendingOperation({
      eventId: earlierEventId,
      roundId,
      userId: "user-1",
      key: "roundConfig",
      label: "後で保存したが辞書順は前",
      operation: {
        type: "round.updated",
        eventId: earlierEventId,
        roundId,
        name: "practice",
        roundDate: "2026-09-15",
        format: "outdoor",
        bowType: "recurve",
      },
    });

    const operations = await loadPendingOperations(roundId, "user-1");

    expect(operations.map((o) => o.eventId)).toEqual([
      earlierEventId,
      laterEventId,
    ]);
  });
});
