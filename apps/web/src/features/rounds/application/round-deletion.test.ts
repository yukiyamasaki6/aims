import { describe, expect, it, vi } from "vitest";
import { roundDisabledOperation } from "../domain/round-progress";
import { roundStreamId } from "../domain/sync-events";
import { createFakeUniqueIds } from "./fake-unique-ids-test-helpers";
import { createRoundDeletion } from "./round-deletion";

// 保存の完了を、1つの列に積んで観測する。
function setup(options: { holdAppend?: boolean } = {}) {
  let finishAppend: () => void = () => {};
  const append = vi.fn(async (_streamId: string, _operation: unknown) => {
    if (options.holdAppend) {
      await new Promise<void>((resolve) => {
        finishAppend = resolve;
      });
    }
  });
  const { ids, issued } = createFakeUniqueIds();
  const deletion = createRoundDeletion({ hub: { append }, ids });
  return { deletion, append, issued, finishAppend: () => finishAppend() };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await flush();
  return done;
}

describe("createRoundDeletion", () => {
  describe("deleteRound", () => {
    it("そのラウンドの列へ、払い出されたイベントIDの削除の操作を追記する", async () => {
      // Given
      const { deletion, append, issued } = setup();

      // When
      await deletion.deleteRound("round-1");

      // Then
      expect(append).toHaveBeenCalledTimes(1);
      expect(append).toHaveBeenCalledWith(
        roundStreamId("round-1"),
        roundDisabledOperation("round-1", issued()[0]),
      );
    });

    it("削除のたびに新しいイベントIDを使う", async () => {
      // Given
      const { deletion, append, issued } = setup();

      // When
      await deletion.deleteRound("round-1");
      await deletion.deleteRound("round-2");

      // Then
      const eventIds = append.mock.calls.map(
        ([, operation]) => (operation as { eventId: string }).eventId,
      );
      expect(new Set(eventIds).size).toBe(2);
      expect(eventIds).toEqual(issued());
    });

    it("保存の試みが終わるまで解決しない", async () => {
      // Given
      const { deletion, finishAppend } = setup({ holdAppend: true });

      // When
      const deleting = deletion.deleteRound("round-1");
      const resolvedBeforeSave = await settled(deleting);
      finishAppend();

      // Then
      expect(resolvedBeforeSave).toBe(false);
      await expect(deleting).resolves.toBeUndefined();
    });
  });
});
