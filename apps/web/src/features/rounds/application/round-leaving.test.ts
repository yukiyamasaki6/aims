import { describe, expect, it, vi } from "vitest";
import { createFakePageNavigation } from "@/lib/page-navigation/fake-page-navigation-test-helpers";
import { ROUNDS_PATH } from "@/routes";
import {
  roundDisabledOperation,
  statusOperation,
} from "../domain/round-progress";
import { roundStreamId } from "../domain/sync-events";
import { createFakeUniqueIds } from "./fake-unique-ids-test-helpers";
import { createRoundDeletion } from "./round-deletion";
import { createRoundLeaving } from "./round-leaving";

// 保存の完了と遷移の順序を、1つの列に積んで観測する。
function setup(options: { holdAppend?: boolean } = {}) {
  const calls: string[] = [];
  let finishAppend: () => void = () => {};
  const append = vi.fn(async (_streamId: string, _operation: unknown) => {
    if (options.holdAppend) {
      await new Promise<void>((resolve) => {
        finishAppend = resolve;
      });
    }
    calls.push("append:done");
  });
  const { pageNavigation, go, replace } = createFakePageNavigation({
    log: calls,
  });
  const { ids, issued } = createFakeUniqueIds();
  const deletion = createRoundDeletion({ hub: { append }, ids });
  const leaving = createRoundLeaving({
    hub: { append },
    ids,
    pageNavigation,
    deletion,
  });
  return {
    leaving,
    append,
    go,
    replace,
    calls,
    issued,
    finishAppend: () => finishAppend(),
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createRoundLeaving", () => {
  describe("completeRound", () => {
    it("そのラウンドの列へ状態を完了にする操作を追記し、追記の完了の後に一覧へ進む", async () => {
      // Given
      const { leaving, append, go, replace, calls, issued, finishAppend } =
        setup({ holdAppend: true });

      // When
      const done = leaving.completeRound("round-1", () => true);
      await flush();
      const beforeFinish = [...calls];
      finishAppend();
      await done;

      // Then
      expect(beforeFinish).toEqual([]);
      expect(append).toHaveBeenCalledTimes(1);
      expect(append).toHaveBeenCalledWith(
        roundStreamId("round-1"),
        statusOperation("round-1", "completed", issued()[0]),
      );
      expect(calls).toEqual(["append:done", `go:${ROUNDS_PATH}`]);
      expect(go).toHaveBeenCalledTimes(1);
      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe("保存の完了を待つ間に画面を離れたとき", () => {
    it.each([
      ["completeRound", "go"],
      ["deleteRoundAndLeave", "replace"],
    ] as const)(
      "%sは、追記は済ませ、遷移しない",
      async (method, navigation) => {
        // Given
        let current = true;
        const { leaving, append, go, replace, finishAppend } = setup({
          holdAppend: true,
        });

        // When
        const done = leaving[method]("round-1", () => current);
        await flush();
        current = false;
        finishAppend();
        await done;

        // Then
        expect(append).toHaveBeenCalledTimes(1);
        expect(navigation === "go" ? go : replace).not.toHaveBeenCalled();
      },
    );
  });

  describe("deleteRoundAndLeave", () => {
    it("そのラウンドの列へ削除の操作を追記し、追記の完了の後に一覧へ置き換えて移る", async () => {
      // Given
      const { leaving, append, go, replace, calls, issued, finishAppend } =
        setup({ holdAppend: true });

      // When
      const done = leaving.deleteRoundAndLeave("round-1", () => true);
      await flush();
      const beforeFinish = [...calls];
      finishAppend();
      await done;

      // Then
      expect(beforeFinish).toEqual([]);
      expect(append).toHaveBeenCalledWith(
        roundStreamId("round-1"),
        roundDisabledOperation("round-1", issued()[0]),
      );
      expect(calls).toEqual(["append:done", `replace:${ROUNDS_PATH}`]);
      expect(replace).toHaveBeenCalledTimes(1);
      expect(go).not.toHaveBeenCalled();
    });
  });

  it.each(["completeRound", "deleteRoundAndLeave"] as const)(
    "%sは、呼ぶたびに新しいイベントIDを使う",
    async (method) => {
      // Given
      const { leaving, append, issued } = setup();

      // When
      await leaving[method]("round-1", () => true);
      await leaving[method]("round-1", () => true);

      // Then
      const eventIds = append.mock.calls.map(
        ([, operation]) => (operation as { eventId: string }).eventId,
      );
      expect(new Set(eventIds).size).toBe(2);
      expect(eventIds).toEqual(issued());
    },
  );
});
