import { describe, expect, it, vi } from "vitest";
import {
  roundDisabledOperation,
  statusOperation,
} from "../domain/round-progress";
import { ROUNDS_PATH } from "../domain/round-routes";
import { roundStreamId } from "../domain/sync-events";
import { createFakeNavigation } from "./fake-navigation-test-helpers";
import { createFakeUniqueIds } from "./fake-unique-ids-test-helpers";
import { createRoundLeaving } from "./leave-round";
import { createTestRoundHub } from "./round-record-test-helpers";

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
  const { navigation, go, replace } = createFakeNavigation({
    log: calls,
    failure: options.navigationFailure,
  });
  const { ids, issued } = createFakeUniqueIds();
  const leaving = createRoundLeaving({ hub: { append }, ids, navigation });
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

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await flush();
  return done;
}

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

  describe("deleteRound", () => {
    it("そのラウンドの列へ、払い出されたイベントIDの削除の操作を追記し、遷移しない", async () => {
      // Given
      const { leaving, append, go, replace, issued } = setup();

      // When
      await leaving.deleteRound("round-1");

      // Then
      expect(append).toHaveBeenCalledTimes(1);
      expect(append).toHaveBeenCalledWith(
        roundStreamId("round-1"),
        roundDisabledOperation("round-1", issued()[0]),
      );
      expect(go).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    it("削除のたびに新しいイベントIDを使う", async () => {
      // Given
      const { leaving, append, issued } = setup();

      // When
      await leaving.deleteRound("round-1");
      await leaving.deleteRound("round-2");

      // Then
      const eventIds = append.mock.calls.map(
        ([, operation]) => (operation as { eventId: string }).eventId,
      );
      expect(new Set(eventIds).size).toBe(2);
      expect(eventIds).toEqual(issued());
    });

    it("保存の試みが終わるまで解決しない", async () => {
      // Given
      const { leaving, finishAppend } = setup({ holdAppend: true });

      // When
      const deleting = leaving.deleteRound("round-1");
      const resolvedBeforeSave = await settled(deleting);
      finishAppend();

      // Then
      expect(resolvedBeforeSave).toBe(false);
      await expect(deleting).resolves.toBeUndefined();
    });

    it("保存が失敗しても拒否せず、メモリの記録には削除を残す", async () => {
      // Given
      const { hub, store } = createTestRoundHub();
      vi.spyOn(store, "append").mockRejectedValue(new Error("保存できない"));
      const leaving = createRoundLeaving({
        hub,
        ids: createFakeUniqueIds().ids,
        navigation: createFakeNavigation().navigation,
      });

      // When
      const deleting = leaving.deleteRound("round-1");

      // Then
      await expect(deleting).resolves.toBeUndefined();
      expect(
        hub.record(roundStreamId("round-1")).items.map((i) => i.operation.type),
      ).toEqual(["round.disabled"]);
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
