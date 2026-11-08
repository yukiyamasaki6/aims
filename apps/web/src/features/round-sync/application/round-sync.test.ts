import { describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import type {
  RoundRecordControl,
  RoundRefreshControl,
} from "@/features/rounds";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createRoundSync } from "./round-sync";

type Needs = ReturnType<RoundRefreshControl["refreshNeeds"]>;
type RefreshReason = Needs["rounds"][number]["reason"];

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
type Reading = Awaited<ReturnType<SessionReader["readSession"]>>;

// 同期の手続きは、いつ取得して反映し、いつ取り直すかを決める。記録の制御、取り直しの制御、サインインの確認、時計、通信の可否は約束で差し替える。
function setup(
  options: { reading?: Reading; match?: "same" | "other" | "unowned" } = {},
) {
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
  const refreshAll = vi.fn(async (): Promise<void> => {});
  const refreshRound = vi.fn(
    async (_roundId: string): Promise<"ok" | "gone" | "failed"> => "ok",
  );
  const state = {
    match: options.match ?? ("same" as "same" | "other" | "unowned"),
  };
  // 制御の窓口と取り直しの窓口の呼び出しを、1つの並びへ名前で積む。順序を確かめるため。
  const calls: string[] = [];
  const control = {
    start: vi.fn((_userId: string | null) => {
      calls.push("control.start");
    }),
    stop: vi.fn(() => {
      calls.push("control.stop");
    }),
    matchUser: vi.fn(() => state.match),
    signInChanged: vi.fn(),
  } satisfies RoundRecordControl;
  const refresh = {
    refreshNeeds: () => needs.current,
    onRefreshNeeds: vi.fn((listener: () => void) => {
      notifyNeeds = listener;
      return () => {
        notifyNeeds = () => {};
      };
    }),
    refreshAll,
    refreshRound,
    reset: vi.fn(() => {
      calls.push("refresh.reset");
    }),
  } satisfies RoundRefreshControl;
  const session: Pick<SessionReader, "readSession"> & { reading: Reading } = {
    reading:
      options.reading ??
      ({ status: "authenticated", userId: "user-1" } as Reading),
    readSession: vi.fn(async (): Promise<Reading> => session.reading),
  };
  const sync = createRoundSync({
    control,
    refresh,
    session,
    connectivity,
  });
  return {
    sync,
    network,
    needs,
    state,
    control,
    refresh,
    calls,
    session,
    refreshAll,
    refreshRound,
    changeNeeds(next: Needs) {
      needs.current = next;
      notifyNeeds();
    },
  };
}

const needsOf = (rounds: Needs["rounds"] = []): Needs => ({ rounds });

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
  it("開始で記録の制御を始め、2回目の開始は何もしない。停止で購読を止め、記録の制御を止めて取り直しの依頼を初期化する", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");

    // When
    t.sync.start("user-2");
    t.sync.stop();

    // Then
    expect(t.control.start).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(t.control.stop).toHaveBeenCalledTimes(1);
    expect(t.refresh.reset).toHaveBeenCalledTimes(1);
  });

  it("停止は、記録の制御を止めた後に取り直しの依頼を初期化する", () => {
    // Given
    const t = setup();
    t.sync.start("user-1");

    // When
    t.sync.stop();

    // Then
    expect(t.calls).toEqual(["control.start", "control.stop", "refresh.reset"]);
  });

  it("サインインの変化は、そのまま記録の制御へ渡す", () => {
    // Given
    const t = setup();
    const change = { kind: "signed-in", userId: "user-2" } as const;

    // When
    t.sync.signInChanged(change);

    // Then
    expect(t.control.signInChanged).toHaveBeenCalledExactlyOnceWith(change);
  });
});

describe("常駐の一括の取得", () => {
  it("開始で、サインイン済みで記録の利用者と同じなら、取得して反映することを1回頼む", async () => {
    // Given
    const t = setup();

    // When
    t.sync.start("user-1");
    await flush();

    // Then
    expect(t.session.readSession).toHaveBeenCalledTimes(1);
    expect(t.refreshAll).toHaveBeenCalledTimes(1);
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
    "%sのときは、開始でも取得しない",
    async (_name, reading, match) => {
      // Given
      const t = setup({ reading, match });

      // When
      t.sync.start("user-1");
      await flush();

      // Then
      expect(t.refreshAll).not.toHaveBeenCalled();
    },
  );

  it("サインインの変化は、取得を起こさない", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    await flush();

    // When
    t.sync.signInChanged({ kind: "signed-in", userId: "user-1" });
    await flush();

    // Then
    expect(t.refreshAll).toHaveBeenCalledTimes(1);
  });

  it("通信の復帰と見える状態(resume)でも同じ前段を通って取得し、取り直しは呼ばない", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    await flush();

    // When
    t.sync.resume();
    await flush();
    t.sync.resume();
    await flush();

    // Then
    expect(t.refreshAll).toHaveBeenCalledTimes(3);
    expect(t.refreshRound).not.toHaveBeenCalled();
  });

  it("前段を通らなかった開始の後でも、通信の復帰では、前段を通れば取得する", async () => {
    // Given
    const t = setup({ reading: { status: "unauthenticated" } as Reading });
    t.sync.start("user-1");
    await flush();
    t.session.reading = { status: "authenticated", userId: "user-1" };

    // When
    t.sync.resume();
    await flush();

    // Then
    expect(t.refreshAll).toHaveBeenCalledTimes(1);
  });

  it("取得が投げても、次の契機で取得する", async () => {
    // Given
    const t = setup();
    t.refreshAll.mockRejectedValueOnce(new Error("boom"));
    t.sync.start("user-1");
    await flush();

    // When
    t.sync.resume();
    await flush();

    // Then
    expect(t.refreshAll).toHaveBeenCalledTimes(2);
  });

  it("常駐の実行中の契機は、完了後に1回だけやり直す(同時に1回まで)", async () => {
    // Given
    const t = setup();
    const first = Promise.withResolvers<void>();
    t.refreshAll.mockReturnValueOnce(first.promise);
    t.sync.start("user-1");
    await flush();

    // When
    t.sync.resume();
    t.sync.resume();
    t.sync.resume();
    await flush();
    const whileRunning = t.refreshAll.mock.calls.length;
    first.resolve();
    await flush();

    // Then
    expect(whileRunning).toBe(1);
    expect(t.refreshAll).toHaveBeenCalledTimes(2);
  });
});

describe("停止をまたぐ一括の取得", () => {
  it("停止前の一括の取得が再開後に終わっても、再開後の扉に触れない", async () => {
    // Given
    const t = setup();
    const old = Promise.withResolvers<void>();
    t.refreshAll.mockReturnValueOnce(old.promise);
    t.sync.start("user-1");
    await flush();
    t.sync.stop();
    const current = Promise.withResolvers<void>();
    t.refreshAll.mockReturnValueOnce(current.promise);
    t.sync.start("user-1");
    await flush();

    // When
    old.resolve();
    await flush();
    t.sync.resume();
    await flush();
    const whileCurrentRuns = t.refreshAll.mock.calls.length;
    current.resolve();
    await flush();

    // Then
    expect(whileCurrentRuns).toBe(2);
    expect(t.refreshAll).toHaveBeenCalledTimes(3);
  });
});

describe("取得の扉は互いを待たない", () => {
  type T = ReturnType<typeof setup>;

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

  it("予約された取り直しは、理由がopenに変わっていると、完了後にやり直さない", async () => {
    // Given
    const t = setup();
    const run1 = Promise.withResolvers<"ok">();
    const open = Promise.withResolvers<"ok">();
    t.refreshRound
      .mockReturnValueOnce(run1.promise)
      .mockReturnValueOnce(open.promise);
    t.needs.current = needsOf([roundNeed("r1", "diverged")]);
    t.sync.start("user-1");
    await flush();
    const afterStart = t.refreshRound.mock.calls.length;

    // When
    t.changeNeeds(needsOf([roundNeed("r1", "diverged")]));
    const afterReservation = t.refreshRound.mock.calls.length;
    t.changeNeeds(needsOf([roundNeed("r1", "open")]));
    await flush();
    run1.resolve("ok");
    await flush();

    // Then
    expect([afterStart, afterReservation]).toEqual([1, 1]);
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  // 停止前の実行が実行中のまま、再開後の扉が新しい取得を始められること(扉が空になること)を、扉ごとに確かめる。
  const doorRows = [
    {
      door: "常駐",
      needs: needsOf(),
      install(t: T, old: Promise<unknown>, current: Promise<unknown>) {
        t.refreshAll
          .mockReturnValueOnce(old as Promise<void>)
          .mockReturnValueOnce(current as Promise<void>);
      },
      overlap: (t: T) => t.sync.resume(),
      count: (t: T) => t.refreshAll.mock.calls.length,
      value: undefined as unknown,
    },
    {
      door: "取り直し",
      needs: needsOf([roundNeed("r1", "diverged")]),
      install(t: T, old: Promise<unknown>, current: Promise<unknown>) {
        t.refreshRound
          .mockReturnValueOnce(old as Promise<"ok">)
          .mockReturnValueOnce(current as Promise<"ok">);
      },
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
      await flush();
      const runningBeforeStop = row.count(t);
      t.sync.stop();
      t.sync.start("user-1");
      await flush();
      const runningAfterResume = row.count(t);

      // When
      old.resolve(row.value);
      await flush();
      const afterOld = row.count(t);
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
    },
  );

  const requestRows = [
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

  it("停止の後に再開し、新しい開く依頼を出すと、1回ずつ実行が始まる(番号を数え直さない)", async () => {
    // Given
    const t = setup();
    t.needs.current = needsOf([roundNeed("r1", "open", 1)]);
    t.sync.start("user-1");
    await flush();
    t.sync.stop();
    // 停止で依頼が消えたことを模す。番号1は残るが、依頼は無い。
    t.needs.current = needsOf();
    t.sync.start("user-1");
    await flush();
    const beforeNew = t.refreshRound.mock.calls.length;

    // When
    t.changeNeeds(needsOf([roundNeed("r1", "open", 2)]));
    await flush();

    // Then
    expect(beforeNew).toBe(1);
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
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

  it("主の理由がopenのときは、reasonsにdivergedがあっても、開く依頼の実行の1回だけを始める", async () => {
    // Given
    const t = setup();
    const withOpen = () => needsOf([roundNeedWith("r1", ["open", "diverged"])]);
    t.needs.current = withOpen();
    t.sync.start("user-1");

    // When
    await flush();
    const afterStart = t.refreshRound.mock.calls.length;
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

describe("停止の後", () => {
  it("停止の後は、依頼の変化に反応しない", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    t.sync.stop();

    // When
    t.changeNeeds(needsOf([roundNeed("r1", "open")]));
    await flush();

    // Then
    expect(t.refreshAll).not.toHaveBeenCalled();
    expect(t.refreshRound).not.toHaveBeenCalled();
  });
});
