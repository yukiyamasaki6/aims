import { describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import type { RoundReconciliation } from "@/features/rounds";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import type { RefreshReason } from "../domain/sync-trigger";
import type { OpSender } from "./op-sender";
import { flush } from "./op-sender-test-helpers";
import { createRoundSync } from "./round-sync";

type Needs = ReturnType<RoundReconciliation["refreshNeeds"]>;
type Reading = Awaited<ReturnType<SessionReader["readSession"]>>;

// 同期の手続きは、いつ取得して反映し、いつ取り直すかを決める。記録、送信器、サインインの確認、時計、通信の可否は約束で差し替える。
function setup(
  options: { reading?: Reading; match?: "same" | "other" | "unowned" } = {},
) {
  const clock = createManualClock();
  const connectivity = createFakeConnectivity();
  // 同期の手続きは通信の可否を読むだけで、通知は契機の受け取りが同期の操作へ変えるため、可否だけを替える。
  const network = {
    set offline(value: boolean) {
      if (value) connectivity.goOffline();
      else connectivity.goOnline();
    },
  };
  const needs: { current: Needs } = { current: needsOf() };
  let notifyNeeds: () => void = () => {};
  const refreshAll = vi.fn(
    async (_options: { waitForList: boolean }): Promise<boolean> => true,
  );
  const refreshRound = vi.fn(
    async (_roundId: string): Promise<"ok" | "gone" | "failed"> => "ok",
  );
  const state = {
    match: options.match ?? ("same" as "same" | "other" | "unowned"),
  };
  const records = {
    start: vi.fn(),
    stop: vi.fn(),
    setUser: vi.fn(),
    matchUser: vi.fn(() => state.match),
    refreshNeeds: () => needs.current,
    onRefreshNeeds: vi.fn((listener: () => void) => {
      notifyNeeds = listener;
      return () => {
        notifyNeeds = () => {};
      };
    }),
    refreshAll,
    refreshRound,
  } as unknown as RoundReconciliation;
  const sender = {
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    resumeHeld: vi.fn(),
    online: vi.fn(),
  } satisfies OpSender;
  const session: Pick<SessionReader, "readSession"> & { reading: Reading } = {
    reading:
      options.reading ??
      ({ status: "authenticated", userId: "user-1" } as Reading),
    readSession: vi.fn(async (): Promise<Reading> => session.reading),
  };
  const sync = createRoundSync({
    records,
    sender: sender as unknown as OpSender,
    session,
    clock,
    connectivity,
  });
  const counts: number[] = [];
  sync.subscribeRefreshed((count) => counts.push(count));
  return {
    sync,
    clock,
    network,
    needs,
    state,
    records,
    sender,
    session,
    refreshAll,
    refreshRound,
    counts,
    changeNeeds(next: Needs) {
      needs.current = next;
      notifyNeeds();
    },
  };
}

// 一覧の依頼の番号が0なら一覧の依頼は無い。番号は残るが依頼が無い状態(停止の後)は、listを偽にして作る。
const needsOf = (
  rounds: Needs["rounds"] = [],
  listRequest = 0,
  list = listRequest > 0,
): Needs => ({ list, listRequest, rounds });

// 理由がopenのときだけ、開く依頼の番号を付ける(既定は1)。reasonsは当たる全ての理由(既定は[reason])で、先頭がreasonである。
const roundNeed = (
  roundId: string,
  reason: RefreshReason,
  openRequest = 1,
  reasons: readonly RefreshReason[] = [reason],
) =>
  reason === "open"
    ? { roundId, reason, reasons, openRequest }
    : { roundId, reason, reasons };

// 当たる全ての理由から作る。主の理由は先頭。
const roundNeedWith = (
  roundId: string,
  reasons: readonly RefreshReason[],
  openRequest = 1,
) => roundNeed(roundId, reasons[0], openRequest, reasons);

describe("開始と停止", () => {
  it("開始で記録と送信器を始め、2回目の開始は何もしない。停止で購読と時計を止め、送信器と記録を止める", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");

    // When
    t.sync.start("user-2");
    t.sync.stop();

    // Then
    expect(t.records.start).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(t.sender.start).toHaveBeenCalledTimes(1);
    expect(t.sender.stop).toHaveBeenCalledTimes(1);
    expect(t.records.stop).toHaveBeenCalledTimes(1);
  });

  it("利用者の切り替えは送信の状態を捨てて記録の利用者を替え、再開は保留を戻し、通信の復帰は送信器へ伝える", () => {
    // Given
    const t = setup();

    // When
    t.sync.switchUser("user-2");
    t.sync.resume();
    t.sync.online();

    // Then
    expect(t.sender.reset).toHaveBeenCalledTimes(1);
    expect(t.records.setUser).toHaveBeenCalledWith("user-2");
    expect(t.sender.resumeHeld).toHaveBeenCalledTimes(1);
    expect(t.sender.online).toHaveBeenCalledTimes(1);
    expect(t.sync.matchUser("user-1")).toBe("same");
  });
});

describe("常駐の一括の取得", () => {
  it("サインイン済みで記録の利用者と同じなら、一覧を待たずに取得して反映し、成功の回数を1増やして知らせる", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");

    // When
    t.sync.refreshAll("resident");
    await flush();

    // Then
    expect(t.refreshAll).toHaveBeenCalledExactlyOnceWith({
      waitForList: false,
    });
    expect(t.counts).toEqual([1]);
  });

  it.each([
    ["未認証", { status: "unauthenticated" } as Reading, "same"],
    ["認証が不明", { status: "unknown" } as Reading, "same"],
    [
      "別の利用者の記録(other)",
      { status: "authenticated", userId: "user-1" } as Reading,
      "other",
    ],
    [
      "利用者のない記録(unowned)",
      { status: "authenticated", userId: "user-1" } as Reading,
      "unowned",
    ],
  ] as const)(
    "%sのときは、取得せず、成功の回数も増やさない",
    async (_name, reading, match) => {
      // Given
      const t = setup({ reading, match });
      t.sync.start("user-1");

      // When
      t.sync.refreshAll("resident");
      await flush();

      // Then
      expect(t.refreshAll).not.toHaveBeenCalled();
      expect(t.counts).toEqual([]);
    },
  );

  it("サインインの確認が投げても、取得せずに続ける", async () => {
    // Given
    const t = setup();
    t.session.readSession = vi.fn(async () => {
      throw new Error("boom");
    });
    t.sync.start("user-1");

    // When
    t.sync.refreshAll("resident");
    await flush();

    // Then
    expect(t.refreshAll).not.toHaveBeenCalled();
  });

  it("通信の復帰と見える状態でも同じ前段を通って取得する。切断では取得しない", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");

    // When
    t.sync.offline();
    await flush();
    const afterOffline = t.refreshAll.mock.calls.length;
    t.sync.online();
    await flush();
    t.sync.visible();
    await flush();

    // Then
    expect(afterOffline).toBe(0);
    expect(t.refreshAll).toHaveBeenCalledTimes(2);
    expect(t.counts).toEqual([1, 2]);
  });

  it("取得に失敗しても(反映しなかった、投げた)、成功の回数を増やさず、次の契機で取得する", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    t.refreshAll.mockResolvedValueOnce(false);
    t.refreshAll.mockRejectedValueOnce(new Error("boom"));

    // When
    t.sync.refreshAll("resident");
    await flush();
    t.sync.refreshAll("resident");
    await flush();
    t.sync.refreshAll("resident");
    await flush();

    // Then
    expect(t.refreshAll).toHaveBeenCalledTimes(3);
    expect(t.counts).toEqual([1]);
  });

  it("常駐の実行中の契機は、完了後に1回だけやり直す(同時に1回まで)", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    const first = Promise.withResolvers<boolean>();
    t.refreshAll.mockReturnValueOnce(first.promise);
    t.sync.refreshAll("resident");
    await flush();

    // When
    t.sync.visible();
    t.sync.online();
    t.sync.refreshAll("resident");
    await flush();
    const whileRunning = t.refreshAll.mock.calls.length;
    first.resolve(true);
    await flush();

    // Then
    expect(whileRunning).toBe(1);
    expect(t.refreshAll).toHaveBeenCalledTimes(2);
  });

  it("停止の後に届いた取得の結果では、成功の回数も通知も更新しない", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    const pending = Promise.withResolvers<boolean>();
    t.refreshAll.mockReturnValueOnce(pending.promise);
    t.sync.refreshAll("resident");
    await flush();

    // When
    t.sync.stop();
    pending.resolve(true);
    await flush();

    // Then
    expect(t.counts).toEqual([]);
  });

  it("購読を解除すると、成功の回数を通知しない", async () => {
    // Given
    const t = setup();
    const listener = vi.fn();
    t.sync.subscribeRefreshed(listener)();
    t.sync.start("user-1");

    // When
    t.sync.refreshAll("resident");
    await flush();

    // Then
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("停止をまたぐ一括の取得", () => {
  it("停止前の一括の取得が再開後に終わっても、成功の回数・通知・ゲートに触れない", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    const old = Promise.withResolvers<boolean>();
    t.refreshAll.mockReturnValueOnce(old.promise);
    t.sync.refreshAll("resident");
    await flush();
    t.sync.stop();
    t.sync.start("user-1");
    const current = Promise.withResolvers<boolean>();
    t.refreshAll.mockReturnValueOnce(current.promise);
    t.sync.refreshAll("resident");
    await flush();

    // When
    old.resolve(true);
    await flush();
    t.sync.visible();
    await flush();
    const whileCurrentRuns = t.refreshAll.mock.calls.length;
    current.resolve(true);
    await flush();

    // Then
    expect(whileCurrentRuns).toBe(2);
    expect(t.counts).toEqual([1, 2]);
  });
});

describe("一覧の依頼", () => {
  it("一覧の依頼だけの実行は、サインインの確認を読まず、一覧の成功を待って反映する。反映しても回数は数えない", async () => {
    // Given
    const t = setup();
    t.needs.current = needsOf([], 1);

    // When
    t.sync.start("user-1");
    await flush();

    // Then
    expect(t.refreshAll).toHaveBeenCalledExactlyOnceWith({ waitForList: true });
    expect(t.session.readSession).not.toHaveBeenCalled();
    expect(t.counts).toEqual([]);
  });

  it("一覧が失敗して反映されなかったときも、回数を増やさない", async () => {
    // Given
    const t = setup();
    t.refreshAll.mockResolvedValue(false);
    t.needs.current = needsOf([], 1);

    // When
    t.sync.start("user-1");
    await flush();

    // Then
    expect(t.counts).toEqual([]);
  });
});

describe("取得の扉は互いを待たない", () => {
  type T = ReturnType<typeof setup>;
  // 常駐の呼び出し(waitForList偽)と一覧の呼び出し(真)を、扉ごとに振り分ける。
  const byDoor = (
    t: T,
    resident: (call: number) => Promise<boolean> | boolean,
    list: (call: number) => Promise<boolean> | boolean,
  ) => {
    const calls = { resident: 0, list: 0 };
    t.refreshAll.mockImplementation(async (options) => {
      if (options.waitForList) {
        calls.list += 1;
        return list(calls.list);
      }
      calls.resident += 1;
      return resident(calls.resident);
    });
  };
  const doors = (t: T) =>
    t.refreshAll.mock.calls.map(([options]) => options.waitForList);

  it("常駐の実行中に一覧の依頼が届くと、常駐の完了を待たずに一覧の取得が始まり、一覧は成功の回数に数えない", async () => {
    // Given
    const t = setup();
    const resident = Promise.withResolvers<boolean>();
    byDoor(
      t,
      () => resident.promise,
      () => true,
    );
    t.sync.start("user-1");
    t.sync.refreshAll("resident");
    await flush();

    // When
    t.changeNeeds(needsOf([], 1));
    await flush();
    const beforeResident = doors(t);
    resident.resolve(true);
    await flush();

    // Then
    expect(beforeResident).toEqual([false, true]);
    expect(t.counts).toEqual([1]);
  });

  it("一覧の実行中に常駐の契機が届くと、すぐに常駐の取得が始まり、一覧が失敗しても常駐は反映して回数を数える", async () => {
    // Given
    const t = setup();
    const list = Promise.withResolvers<boolean>();
    byDoor(
      t,
      () => true,
      () => list.promise,
    );
    t.needs.current = needsOf([], 1);
    t.sync.start("user-1");
    await flush();

    // When
    t.sync.refreshAll("resident");
    await flush();
    const beforeList = doors(t);
    const countsBeforeList = [...t.counts];
    list.resolve(false);
    await flush();

    // Then
    expect(beforeList).toEqual([true, false]);
    expect(countsBeforeList).toEqual([1]);
    expect(t.counts).toEqual([1]);
  });

  it("一覧の実行中に一覧の依頼が届くと、すぐに次の一覧の実行が並行して始まり、依頼ごとに1回だけ実行する", async () => {
    // Given
    const t = setup();
    const list = Promise.withResolvers<boolean>();
    byDoor(
      t,
      () => true,
      (call) => (call === 1 ? list.promise : true),
    );
    t.needs.current = needsOf([], 1);
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds(needsOf([], 2));
    await flush();
    const afterSecond = doors(t).length;
    t.changeNeeds(needsOf([], 2));
    t.changeNeeds(needsOf([], 2));
    await flush();
    const afterRepeat = doors(t).length;
    list.resolve(true);
    await flush();

    // Then
    expect(afterSecond).toBe(2);
    expect(afterRepeat).toBe(2);
    expect(doors(t)).toEqual([true, true]);
  });

  it("取り直しの実行中に開く依頼が届くと、すぐに開く依頼の取得が始まり、開く依頼が続いたときは、依頼ごとにすぐ取得を始める", async () => {
    // Given
    const t = setup();
    const retry = Promise.withResolvers<"ok">();
    const open = Promise.withResolvers<"ok">();
    t.refreshRound
      .mockReturnValueOnce(retry.promise)
      .mockReturnValueOnce(open.promise);
    t.needs.current = needsOf([roundNeed("r1", "diverged")]);
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds(needsOf([roundNeed("r1", "open", 1)]));
    await flush();
    const afterOpenArrived = t.refreshRound.mock.calls.length;
    t.changeNeeds(needsOf([roundNeed("r1", "open", 2)]));
    await flush();
    const afterNextRequest = t.refreshRound.mock.calls.length;
    t.changeNeeds(needsOf([roundNeed("r1", "open", 2)]));
    t.changeNeeds(needsOf([roundNeed("r1", "open", 2)]));
    open.resolve("ok");
    retry.resolve("ok");
    await flush();

    // Then
    expect(afterOpenArrived).toBe(2);
    expect(afterNextRequest).toBe(3);
    expect(t.refreshRound).toHaveBeenCalledTimes(3);
  });

  describe("予約された取り直しと開く依頼", () => {
    // 時計の期限でstaleの取得を始め、その実行中にdivergedの知らせで予約を入れ、理由をopenに変える。
    async function reservedThenOpen() {
      const t = setup();
      const run1 = Promise.withResolvers<"ok">();
      const open = Promise.withResolvers<"ok">();
      t.refreshRound
        .mockReturnValueOnce(run1.promise)
        .mockReturnValueOnce(open.promise);
      t.needs.current = needsOf([roundNeed("r1", "stale")]);
      t.sync.start("user-1");
      await t.clock.advanceAsync(3000);
      const afterDeadline = t.refreshRound.mock.calls.length;
      t.changeNeeds(needsOf([roundNeed("r1", "diverged")]));
      const afterReservation = t.refreshRound.mock.calls.length;
      t.changeNeeds(needsOf([roundNeed("r1", "open")]));
      await flush();
      run1.resolve("ok");
      await flush();
      return { t, open, afterDeadline, afterReservation };
    }

    it("予約された取り直しは、理由がopenに変わっていると、完了後にやり直さない", async () => {
      // Given
      // When
      const { t, afterDeadline, afterReservation } = await reservedThenOpen();

      // Then
      expect([afterDeadline, afterReservation]).toEqual([1, 1]);
      expect(t.refreshRound).toHaveBeenCalledTimes(2);
    });

    it("開く依頼が解決して理由がstaleに戻ると、時計の期限の後に取り直しが始まる", async () => {
      // Given
      const { t, open } = await reservedThenOpen();

      // When
      open.resolve("ok");
      t.changeNeeds(needsOf([roundNeed("r1", "stale")]));
      await t.clock.advanceAsync(5999);
      const beforeDeadline = t.refreshRound.mock.calls.length;
      await t.clock.advanceAsync(1);

      // Then
      // 最初のstaleの取得の続きで試行番号が1になるため、待機は6000msである。
      expect(beforeDeadline).toBe(2);
      expect(t.refreshRound).toHaveBeenCalledTimes(3);
    });
  });

  // 停止前の実行が実行中のまま、再開後の扉が新しい取得を始められること(扉が空になること)を、扉ごとに確かめる。
  const doorRows = [
    {
      door: "常駐",
      needs: needsOf(),
      resident: true,
      install(t: T, old: Promise<unknown>, current: Promise<unknown>) {
        byDoor(
          t,
          (n) =>
            n === 1
              ? (old as Promise<boolean>)
              : n === 2
                ? (current as Promise<boolean>)
                : true,
          () => true,
        );
      },
      begin: (t: T) => t.sync.refreshAll("resident"),
      overlap: (t: T) => t.sync.refreshAll("resident"),
      count: (t: T) => doors(t).filter((door) => !door).length,
      value: true,
    },
    {
      door: "取り直し",
      needs: needsOf([roundNeed("r1", "diverged")]),
      resident: false,
      install(t: T, old: Promise<unknown>, current: Promise<unknown>) {
        t.refreshRound
          .mockReturnValueOnce(old as Promise<"ok">)
          .mockReturnValueOnce(current as Promise<"ok">);
      },
      begin: () => {},
      overlap: (t: T) => t.changeNeeds(needsOf([roundNeed("r1", "diverged")])),
      count: (t: T) => t.refreshRound.mock.calls.length,
      value: "ok" as unknown,
    },
  ];

  it.each(doorRows)(
    "停止すると$doorの扉と予約が空になり、停止前の実行の完了は、再開後の実行の扉と予約に触れない",
    async (row) => {
      // Given
      const t = setup();
      const old = Promise.withResolvers<unknown>();
      const current = Promise.withResolvers<unknown>();
      row.install(t, old.promise, current.promise);
      t.needs.current = row.needs;
      t.sync.start("user-1");
      row.begin(t);
      await flush();
      const runningBeforeStop = row.count(t);
      t.sync.stop();
      t.sync.start("user-1");
      row.begin(t);
      await flush();
      const runningAfterResume = row.count(t);

      // When
      old.resolve(row.value);
      await flush();
      const afterOld = row.count(t);
      const countsAfterOld = [...t.counts];
      row.overlap(t);
      row.overlap(t);
      await flush();
      const afterOverlap = row.count(t);
      current.resolve(row.value);
      await flush();

      // Then
      expect([runningBeforeStop, runningAfterResume]).toEqual([1, 2]);
      expect(afterOld).toBe(2);
      expect(afterOverlap).toBe(2);
      expect(row.count(t)).toBe(3);
      expect(countsAfterOld).toEqual([]);
      // 停止前の実行は数えず、再開後の実行と、その完了後の1回のやり直しだけを数える。
      if (row.resident) expect(t.counts).toEqual([1, 2]);
    },
  );

  const requestRows = [
    {
      request: "一覧",
      needs: needsOf([], 1),
      install(t: T, old: Promise<unknown>, current: Promise<unknown>) {
        byDoor(
          t,
          () => true,
          (n) =>
            n === 1
              ? (old as Promise<boolean>)
              : n === 2
                ? (current as Promise<boolean>)
                : true,
        );
      },
      next: (t: T) => t.changeNeeds(needsOf([], 2)),
      same: (t: T) => t.changeNeeds(needsOf([], 1)),
      count: (t: T) => doors(t).filter((door) => door).length,
      value: true,
    },
    {
      request: "開く依頼",
      needs: needsOf([roundNeed("r1", "open", 1)]),
      install(t: T, old: Promise<unknown>, current: Promise<unknown>) {
        t.refreshRound
          .mockReturnValueOnce(old as Promise<"ok">)
          .mockReturnValueOnce(current as Promise<"ok">);
      },
      next: (t: T) => t.changeNeeds(needsOf([roundNeed("r1", "open", 2)])),
      same: (t: T) => t.changeNeeds(needsOf([roundNeed("r1", "open", 1)])),
      count: (t: T) => t.refreshRound.mock.calls.length,
      value: "ok" as unknown,
    },
  ];

  it.each(requestRows)(
    "停止すると$requestの記録した依頼の番号が空になり、停止前の実行の完了は、再開後の実行に触れない。同じ番号の知らせでは重ねず、新しい番号の依頼は並行して始まる",
    async (row) => {
      // Given
      const t = setup();
      const old = Promise.withResolvers<unknown>();
      const current = Promise.withResolvers<unknown>();
      row.install(t, old.promise, current.promise);
      t.needs.current = row.needs;
      t.sync.start("user-1");
      await flush();
      const runningBeforeStop = row.count(t);
      t.sync.stop();
      t.sync.start("user-1");
      await flush();
      // 要否は停止で消えないため、再開後の評価が同じ番号の依頼をもう一度見る。再開で記録した番号を捨てているので、実行が始まる。
      const runningAfterResume = row.count(t);

      // When
      old.resolve(row.value);
      await flush();
      const afterOld = row.count(t);
      row.same(t);
      row.same(t);
      await flush();
      const afterSame = row.count(t);
      current.resolve(row.value);
      await flush();
      const afterCurrent = row.count(t);
      row.next(t);
      await flush();

      // Then
      expect([runningBeforeStop, runningAfterResume]).toEqual([1, 2]);
      expect(afterOld).toBe(2);
      expect(afterSame).toBe(2);
      expect(afterCurrent).toBe(2);
      expect(row.count(t)).toBe(3);
    },
  );
});

describe("依頼の番号", () => {
  type T = ReturnType<typeof setup>;
  const doors = (t: T) =>
    t.refreshAll.mock.calls.map(([options]) => options.waitForList);

  it("開く依頼の番号が増えなければ、記録の知らせが何度届いても、refreshRoundを重ねて呼ばない。初めての開く依頼では、ちょうど1回呼ぶ", async () => {
    // Given
    const t = setup();
    const open = Promise.withResolvers<"ok">();
    t.refreshRound.mockReturnValueOnce(open.promise);
    t.needs.current = needsOf([roundNeed("r1", "open", 1)]);
    t.sync.start("user-1");
    await flush();
    const afterFirst = t.refreshRound.mock.calls.length;

    // When
    t.changeNeeds(needsOf([roundNeed("r1", "open", 1)]));
    t.changeNeeds(needsOf([roundNeed("r1", "open", 1)]));
    t.changeNeeds(needsOf([roundNeed("r1", "open", 1)]));
    await flush();

    // Then
    expect(afterFirst).toBe(1);
    expect(t.refreshRound).toHaveBeenCalledTimes(1);
  });

  it("一覧の依頼の番号が増えなければ、知らせが何度届いても、一覧の実行を重ねない", async () => {
    // Given
    const t = setup();
    const list = Promise.withResolvers<boolean>();
    t.refreshAll.mockImplementation(() => list.promise);
    t.needs.current = needsOf([], 1);
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds(needsOf([], 1));
    t.changeNeeds(needsOf([], 1));
    t.changeNeeds(needsOf([], 1));
    await flush();

    // Then
    expect(doors(t)).toEqual([true]);
  });

  it("停止の後に再開し、新しい開く依頼と一覧の依頼を出すと、それぞれ1回ずつ実行が始まる(番号を数え直さない)", async () => {
    // Given
    const t = setup();
    t.needs.current = needsOf([roundNeed("r1", "open", 1)], 1);
    t.sync.start("user-1");
    await flush();
    t.sync.stop();
    // 停止で依頼が消えたことを模す。番号1は残るが、一覧の依頼は無い。
    t.needs.current = needsOf([], 1, false);
    t.sync.start("user-1");
    await flush();
    const beforeNew = [
      t.refreshRound.mock.calls.length,
      doors(t).filter(Boolean).length,
    ];

    // When
    t.changeNeeds(needsOf([roundNeed("r1", "open", 2)], 2));
    await flush();

    // Then
    expect(beforeNew).toEqual([1, 1]);
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
    expect(doors(t).filter(Boolean)).toHaveLength(2);
  });
});

describe("ラウンドごとの取り直し", () => {
  it("開いたときの依頼は、オフラインでも取り直す", async () => {
    // Given
    const t = setup();
    t.network.offline = true;
    t.needs.current = needsOf([roundNeed("r1", "open")]);

    // When
    t.sync.start("user-1");
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledExactlyOnceWith("r1");
  });

  it.each(["diverged", "overlay"] as const)(
    "%sの取り直しは、オフラインでは行わず、オンラインでは行う",
    async (reason) => {
      // Given
      const offline = setup();
      offline.network.offline = true;
      offline.needs.current = needsOf([roundNeed("r1", reason)]);
      const online = setup();
      online.needs.current = needsOf([roundNeed("r1", reason)]);

      // When
      offline.sync.start("user-1");
      online.sync.start("user-1");
      await flush();

      // Then
      expect(offline.refreshRound).not.toHaveBeenCalled();
      expect(online.refreshRound).toHaveBeenCalledExactlyOnceWith("r1");
    },
  );

  it("効かなかった結果(diverged)以外の同じ理由の知らせでは、取り直しを重ねない(新しく要る、または理由が変わったときだけ始める)", async () => {
    // Given
    const t = setup();
    t.needs.current = needsOf([roundNeed("r1", "overlay")]);
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds(needsOf([roundNeed("r1", "overlay")]));
    await flush();
    t.changeNeeds(needsOf([roundNeed("r1", "diverged")]));
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  it("効かなかった結果(diverged)は、理由が同じでも知らせるたびに取り直しを求める", async () => {
    // Given
    const t = setup();
    t.needs.current = needsOf([roundNeed("r1", "diverged")]);
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds(needsOf([roundNeed("r1", "diverged")]));
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  it("取り直しの最中に効かなかった結果の知らせが重ねて届いても、完了後に1回だけやり直す", async () => {
    // Given
    const t = setup();
    const running = Promise.withResolvers<"ok">();
    t.refreshRound.mockReturnValueOnce(running.promise);
    const diverged: Needs = needsOf([roundNeed("r1", "diverged")]);
    t.needs.current = diverged;
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds(diverged);
    t.changeNeeds(diverged);
    const whileRunning = t.refreshRound.mock.calls.length;
    running.resolve("ok");
    await flush();

    // Then
    expect(whileRunning).toBe(1);
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  it("ラウンドごとに同時に1回まで。実行中に届いた理由は、完了後に1回だけやり直す", async () => {
    // Given
    const t = setup();
    const running = Promise.withResolvers<"ok">();
    t.refreshRound.mockReturnValueOnce(running.promise);
    t.needs.current = needsOf([roundNeed("r1", "diverged")]);
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds(needsOf([roundNeed("r1", "overlay")]));
    t.changeNeeds(needsOf([roundNeed("r1", "diverged")]));
    const whileRunning = t.refreshRound.mock.calls.length;
    running.resolve("ok");
    await flush();

    // Then
    expect(whileRunning).toBe(1);
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  it("取り直しが投げても続ける", async () => {
    // Given
    const t = setup();
    t.refreshRound.mockRejectedValueOnce(new Error("boom"));
    t.needs.current = needsOf([roundNeed("r1", "open")]);
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds(needsOf([roundNeed("r1", "diverged")]));
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  describe("端末のベースで開いている間", () => {
    const staleNeeds = (): Needs => needsOf([roundNeed("r1", "stale")]);

    it("3秒から倍に伸ばした間隔で、取得できるまで取り直す", async () => {
      // Given
      const t = setup();
      t.needs.current = staleNeeds();
      t.sync.start("user-1");
      await flush();

      // When
      await t.clock.advanceAsync(2999);
      const beforeFirst = t.refreshRound.mock.calls.length;
      await t.clock.advanceAsync(1);
      const afterFirst = t.refreshRound.mock.calls.length;
      await t.clock.advanceAsync(5999);
      const beforeSecond = t.refreshRound.mock.calls.length;
      await t.clock.advanceAsync(1);

      // Then
      expect([beforeFirst, afterFirst, beforeSecond]).toEqual([0, 1, 1]);
      expect(t.refreshRound).toHaveBeenCalledTimes(2);
    });

    it("取得できて端末のベースで開いている状態でなくなったら、時計を止める", async () => {
      // Given
      const t = setup();
      t.needs.current = staleNeeds();
      t.sync.start("user-1");
      await flush();

      // When
      t.changeNeeds(needsOf());
      await t.clock.advanceAsync(60_000);

      // Then
      expect(t.refreshRound).not.toHaveBeenCalled();
      expect(t.clock.pendingCount()).toBe(0);
    });

    it("オフラインの間は取り直さず、切断で時計を止め、通信の復帰で試行を0から数え直して取り直す", async () => {
      // Given
      const t = setup();
      t.needs.current = staleNeeds();
      t.sync.start("user-1");
      await flush();
      await t.clock.advanceAsync(3000);
      t.sync.offline();
      t.network.offline = true;
      const pendingAfterOffline = t.clock.pendingCount();
      await t.clock.advanceAsync(60_000);
      const whileOffline = t.refreshRound.mock.calls.length;

      // When
      t.network.offline = false;
      t.sync.online();
      await flush();
      const afterOnline = t.refreshRound.mock.calls.length;
      await t.clock.advanceAsync(3000);

      // Then
      expect(pendingAfterOffline).toBe(0);
      expect(whileOffline).toBe(1);
      expect(afterOnline).toBe(2);
      expect(t.refreshRound).toHaveBeenCalledTimes(3);
    });

    it("見える状態になったときに、試行を0から数え直して取り直す", async () => {
      // Given
      const t = setup();
      t.needs.current = staleNeeds();
      t.sync.start("user-1");
      await flush();
      await t.clock.advanceAsync(3000);
      await t.clock.advanceAsync(6000);

      // When
      t.sync.visible();
      await flush();

      // Then
      expect(t.refreshRound).toHaveBeenCalledTimes(3);
    });

    it("端末のベースで開いている詳細だけを取り直し、ほかの理由の詳細は通信の復帰で取り直さない", async () => {
      // Given
      const t = setup();
      t.needs.current = needsOf([roundNeed("quiet", "overlay")]);
      t.sync.start("user-1");
      await flush();
      t.refreshRound.mockClear();

      // When
      t.sync.online();
      await flush();

      // Then
      expect(t.refreshRound).not.toHaveBeenCalled();
    });

    it("詳細を閉じた後は、実行中に予約された再取得を実行しない", async () => {
      // Given
      const t = setup();
      const running = Promise.withResolvers<"ok">();
      t.refreshRound.mockReturnValueOnce(running.promise);
      t.needs.current = needsOf([roundNeed("r1", "diverged")]);
      t.sync.start("user-1");
      await flush();
      t.changeNeeds(needsOf([roundNeed("r1", "overlay")]));

      // When
      t.changeNeeds(needsOf());
      running.resolve("ok");
      await flush();

      // Then
      expect(t.refreshRound).toHaveBeenCalledTimes(1);
    });

    it("詳細を開き直すと、試行番号を引き継がず、0から3秒で取り直す", async () => {
      // Given
      const t = setup();
      t.needs.current = staleNeeds();
      t.sync.start("user-1");
      await flush();
      await t.clock.advanceAsync(3000);
      await t.clock.advanceAsync(6000);
      t.changeNeeds(needsOf());
      const before = t.refreshRound.mock.calls.length;

      // When
      t.changeNeeds(staleNeeds());
      await t.clock.advanceAsync(2999);
      const early = t.refreshRound.mock.calls.length;
      await t.clock.advanceAsync(1);

      // Then
      expect(early).toBe(before);
      expect(t.refreshRound).toHaveBeenCalledTimes(before + 1);
    });

    it("閉じる前から実行中だった取得の完了は、開き直した後の試行番号を進めない", async () => {
      // Given
      const t = setup();
      const old = Promise.withResolvers<"ok">();
      t.refreshRound.mockReturnValueOnce(old.promise);
      t.needs.current = staleNeeds();
      t.sync.start("user-1");
      await flush();
      await t.clock.advanceAsync(3000);
      t.changeNeeds(needsOf());
      t.changeNeeds(staleNeeds());
      await t.clock.advanceAsync(3000);
      old.resolve("ok");
      await flush();
      const afterFirst = t.refreshRound.mock.calls.length;

      // When
      await t.clock.advanceAsync(6000);

      // Then
      expect(afterFirst).toBe(2);
      expect(t.refreshRound).toHaveBeenCalledTimes(3);
    });

    it("停止で時計を止める", async () => {
      // Given
      const t = setup();
      t.needs.current = staleNeeds();
      t.sync.start("user-1");
      await flush();

      // When
      t.sync.stop();

      // Then
      expect(t.clock.pendingCount()).toBe(0);
    });
  });

  describe("端末のベースで開いている間に、差を知った時点で取り直す", () => {
    const staleWith = (...extra: RefreshReason[]) =>
      needsOf([roundNeedWith("r1", ["stale", ...extra])]);
    const calls = (t: ReturnType<typeof setup>) =>
      t.refreshRound.mock.calls.length;

    it("主の理由がstaleの間にreasonsへdivergedが加わると、時計の期限を待たずに取り直す。時計(元の期限)と試行の番号は変えない", async () => {
      // Given
      const t = setup();
      t.needs.current = staleWith();
      t.sync.start("user-1");
      await flush();
      await t.clock.advanceAsync(1000);

      // When
      t.changeNeeds(staleWith("diverged"));
      await flush();
      const afterJoin = calls(t);
      await t.clock.advanceAsync(1999);
      const beforeDeadline = calls(t);
      await t.clock.advanceAsync(1);
      const atDeadline = calls(t);
      await t.clock.advanceAsync(5999);
      const beforeSecond = calls(t);
      await t.clock.advanceAsync(1);

      // Then
      expect([afterJoin, beforeDeadline, atDeadline, beforeSecond]).toEqual([
        1, 1, 2, 2,
      ]);
      expect(t.refreshRound).toHaveBeenCalledTimes(3);
    });

    it("divergedが続く間は、知らせのたびに取り直しを求める。時計の期限は動かない", async () => {
      // Given
      const t = setup();
      t.needs.current = staleWith();
      t.sync.start("user-1");
      await flush();
      await t.clock.advanceAsync(1000);

      // When
      for (let i = 0; i < 3; i += 1) {
        t.changeNeeds(staleWith("diverged"));
        await flush();
      }
      const afterNotices = calls(t);
      await t.clock.advanceAsync(1999);
      const beforeDeadline = calls(t);
      await t.clock.advanceAsync(1);

      // Then
      expect(afterNotices).toBe(3);
      expect(beforeDeadline).toBe(3);
      expect(t.refreshRound).toHaveBeenCalledTimes(4);
    });

    it("時計の取り直しの実行中にdivergedが加わると、重ねて始めず、完了後に1回だけやり直す。完了後の時計は、今の規則の6000msで続く", async () => {
      // Given
      const t = setup();
      const running = Promise.withResolvers<"ok">();
      t.refreshRound.mockReturnValueOnce(running.promise);
      t.needs.current = staleWith();
      t.sync.start("user-1");
      await t.clock.advanceAsync(3000);

      // When
      t.changeNeeds(staleWith("diverged"));
      t.changeNeeds(staleWith("diverged"));
      t.changeNeeds(staleWith("diverged"));
      await flush();
      const whileRunning = calls(t);
      running.resolve("ok");
      await flush();
      const afterRerun = calls(t);
      await t.clock.advanceAsync(5999);
      const beforeNext = calls(t);
      await t.clock.advanceAsync(1);

      // Then
      expect([whileRunning, afterRerun, beforeNext]).toEqual([1, 2, 2]);
      expect(t.refreshRound).toHaveBeenCalledTimes(3);
    });

    it("主の理由がstaleの間にreasonsへoverlayが加わると、すぐ1回取り直す。overlayが続く間の知らせでは重ねない。時計の期限は動かない", async () => {
      // Given
      const t = setup();
      t.needs.current = staleWith();
      t.sync.start("user-1");
      await flush();
      await t.clock.advanceAsync(1000);

      // When
      t.changeNeeds(staleWith("overlay"));
      await flush();
      const afterJoin = calls(t);
      t.changeNeeds(staleWith("overlay"));
      t.changeNeeds(staleWith("overlay"));
      await flush();
      const afterRepeat = calls(t);
      await t.clock.advanceAsync(1999);
      const beforeDeadline = calls(t);
      await t.clock.advanceAsync(1);

      // Then
      expect([afterJoin, afterRepeat, beforeDeadline]).toEqual([1, 1, 1]);
      expect(t.refreshRound).toHaveBeenCalledTimes(2);
    });

    it("overlayが外れてまた当たると、新しく当たったものとして1回取り直す。時計の期限は動かない", async () => {
      // Given
      const t = setup();
      t.needs.current = staleWith();
      t.sync.start("user-1");
      await flush();
      await t.clock.advanceAsync(1000);
      t.changeNeeds(staleWith("overlay"));
      await flush();

      // When
      t.changeNeeds(staleWith());
      await flush();
      const afterRemoved = calls(t);
      t.changeNeeds(staleWith("overlay"));
      await flush();
      const afterRejoin = calls(t);
      await t.clock.advanceAsync(1999);
      const beforeDeadline = calls(t);
      await t.clock.advanceAsync(1);

      // Then
      expect([afterRemoved, afterRejoin, beforeDeadline]).toEqual([1, 2, 2]);
      expect(t.refreshRound).toHaveBeenCalledTimes(3);
    });

    it("停止して再開すると、overlayが当たっていれば1回取り直す。時計は再開の時点から3000msで数え直す", async () => {
      // Given
      const t = setup();
      t.needs.current = staleWith();
      t.sync.start("user-1");
      await flush();
      await t.clock.advanceAsync(1000);
      t.changeNeeds(staleWith("overlay"));
      await flush();

      // When
      t.sync.stop();
      t.sync.start("user-1");
      await flush();
      const afterRestart = calls(t);
      await t.clock.advanceAsync(2999);
      const beforeDeadline = calls(t);
      await t.clock.advanceAsync(1);

      // Then
      expect([afterRestart, beforeDeadline]).toEqual([2, 2]);
      expect(t.refreshRound).toHaveBeenCalledTimes(3);
    });

    it("オフラインでは、主の理由がstaleの間にdivergedかoverlayが加わっても取り直さない", async () => {
      // Given
      const t = setup();
      t.needs.current = staleWith();
      t.sync.start("user-1");
      await flush();
      t.network.offline = true;

      // When
      t.changeNeeds(staleWith("diverged"));
      t.changeNeeds(staleWith("overlay"));
      await flush();

      // Then
      expect(t.refreshRound).not.toHaveBeenCalled();
    });

    it("主の理由がopenのときは、reasonsにstaleやdivergedがあっても、開く依頼の実行の1回だけを始める", async () => {
      // Given
      const t = setup();
      const withOpen = () =>
        needsOf([roundNeedWith("r1", ["open", "stale", "diverged"])]);
      t.needs.current = withOpen();
      t.sync.start("user-1");

      // When
      await flush();
      const afterStart = calls(t);
      t.changeNeeds(withOpen());
      t.changeNeeds(withOpen());
      await flush();

      // Then
      expect(afterStart).toBe(1);
      expect(t.refreshRound).toHaveBeenCalledTimes(1);
    });

    it("主の理由がdivergedのときは、reasonsにoverlayが加わっていても、知らせごとに取り直しを1回だけ求める", async () => {
      // Given
      const t = setup();
      const diverged = () =>
        needsOf([roundNeedWith("r1", ["diverged", "overlay"])]);
      t.needs.current = diverged();
      t.sync.start("user-1");
      await flush();

      // When
      t.changeNeeds(diverged());
      await flush();

      // Then
      expect(t.refreshRound).toHaveBeenCalledTimes(2);
    });
  });
});

describe("停止の後", () => {
  it("停止の後は、依頼の変化に反応しない", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    t.sync.stop();

    // When
    t.changeNeeds(needsOf([roundNeed("r1", "open")], 1));
    await flush();

    // Then
    expect(t.refreshAll).not.toHaveBeenCalled();
    expect(t.refreshRound).not.toHaveBeenCalled();
  });
});
