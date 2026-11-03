import { describe, expect, it, vi } from "vitest";
import { createFakePageNavigation } from "@/lib/page-navigation/fake-page-navigation-test-helpers";
import {
  roundDisabledOperation,
  statusOperation,
} from "../domain/round-progress";
import { ROUNDS_PATH } from "../domain/round-routes";
import { roundStreamId } from "../domain/sync-events";
import { createFakeUniqueIds } from "./fake-unique-ids-test-helpers";
import { createRoundDeletion } from "./round-deletion";
import { createRoundLeaving } from "./round-leaving";

// 保存の完了と遷移の順序を、1つの列に積んで観測する。
function setup(
  options: { holdAppend?: boolean; navigationFailure?: Error } = {},
) {
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
    failure: options.navigationFailure,
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
      const done = leaving.completeRound("round-1");
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

    it("遷移が投げたときは、その例外で拒否する。追記は済んでいる", async () => {
      // Given
      const failure = new Error("go failed");
      const { leaving, append } = setup({ navigationFailure: failure });

      // When
      const outcome = leaving.completeRound("round-1");

      // Then
      await expect(outcome).rejects.toBe(failure);
      expect(append).toHaveBeenCalledTimes(1);
    });
  });

  describe("deleteRoundAndLeave", () => {
    it("そのラウンドの列へ削除の操作を追記し、追記の完了の後に一覧へ置き換えて移る", async () => {
      // Given
      const { leaving, append, go, replace, calls, issued, finishAppend } =
        setup({ holdAppend: true });

      // When
      const done = leaving.deleteRoundAndLeave("round-1");
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

    it("遷移が投げたときは、その例外で拒否する。追記は済んでいる", async () => {
      // Given
      const failure = new Error("replace failed");
      const { leaving, append } = setup({ navigationFailure: failure });

      // When
      const outcome = leaving.deleteRoundAndLeave("round-1");

      // Then
      await expect(outcome).rejects.toBe(failure);
      expect(append).toHaveBeenCalledTimes(1);
    });
  });

  describe("leaveRound", () => {
    it("追記せず、直ちに一覧へ置き換えて移る", () => {
      // Given
      const { leaving, append, go, replace } = setup();

      // When
      leaving.leaveRound();

      // Then
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith(ROUNDS_PATH);
      expect(append).not.toHaveBeenCalled();
      expect(go).not.toHaveBeenCalled();
    });

    it("遷移が投げたときは、その例外を投げる", () => {
      // Given
      const failure = new Error("replace failed");
      const { leaving } = setup({ navigationFailure: failure });

      // When
      const leave = () => leaving.leaveRound();

      // Then
      expect(leave).toThrow(failure);
    });
  });

  it.each(["completeRound", "deleteRoundAndLeave"] as const)(
    "%sは、呼ぶたびに新しいイベントIDを使う",
    async (method) => {
      // Given
      const { leaving, append, issued } = setup();

      // When
      await leaving[method]("round-1");
      await leaving[method]("round-1");

      // Then
      const eventIds = append.mock.calls.map(
        ([, operation]) => (operation as { eventId: string }).eventId,
      );
      expect(new Set(eventIds).size).toBe(2);
      expect(eventIds).toEqual(issued());
    },
  );
});
