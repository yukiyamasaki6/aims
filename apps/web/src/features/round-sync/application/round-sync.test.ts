import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import type { RefreshReason } from "../domain/sync-trigger";
import type { OpSender } from "./op-sender";
import { flush } from "./op-sender-test-helpers";
import type { RecordsPort } from "./records-port";
import { createRoundSync } from "./round-sync";
import type { SessionCheck } from "./session-check";

type Needs = ReturnType<RecordsPort["refreshNeeds"]>;
type Reading = Awaited<ReturnType<SessionCheck["read"]>>;

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
  const needs: { current: Needs } = { current: { list: false, rounds: [] } };
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
  } as unknown as RecordsPort;
  const sender = {
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    resumeHeld: vi.fn(),
    online: vi.fn(),
  } satisfies OpSender;
  const session: SessionCheck & { reading: Reading } = {
    reading:
      options.reading ??
      ({ status: "authenticated", userId: "user-1" } as Reading),
    read: vi.fn(async (): Promise<Reading> => session.reading),
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

const roundNeed = (roundId: string, reason: RefreshReason) => ({
  roundId,
  reason,
});

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
    t.session.read = vi.fn(async () => {
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

  it("実行中の契機は、完了後に1回だけやり直す(同時に1回まで)", async () => {
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
    t.needs.current = { list: true, rounds: [] };

    // When
    t.sync.start("user-1");
    await flush();

    // Then
    expect(t.refreshAll).toHaveBeenCalledExactlyOnceWith({ waitForList: true });
    expect(t.session.read).not.toHaveBeenCalled();
    expect(t.counts).toEqual([]);
  });

  it("一覧が失敗して反映されなかったときも、回数を増やさない", async () => {
    // Given
    const t = setup();
    t.refreshAll.mockResolvedValue(false);
    t.needs.current = { list: true, rounds: [] };

    // When
    t.sync.start("user-1");
    await flush();

    // Then
    expect(t.counts).toEqual([]);
  });

  it("常駐の契機と一覧の依頼が1回の実行に重なったとき、前段を通れば一覧の成否を待たずに反映し、回数を数える", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    const first = Promise.withResolvers<boolean>();
    t.refreshAll.mockReturnValueOnce(first.promise);
    t.sync.refreshAll("resident");
    await flush();
    t.needs.current = { list: true, rounds: [] };

    // When
    t.changeNeeds(t.needs.current);
    t.sync.refreshAll("resident");
    first.resolve(true);
    await flush();

    // Then
    expect(t.refreshAll).toHaveBeenLastCalledWith({ waitForList: false });
    expect(t.counts).toEqual([1, 2]);
  });

  it("重なったとき、前段を通らなければ、一覧の依頼だけのときと同じにする(一覧の成功を待ち、回数は数えない)", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    const first = Promise.withResolvers<boolean>();
    t.refreshAll.mockReturnValueOnce(first.promise);
    t.sync.refreshAll("resident");
    await flush();
    t.session.reading = { status: "unauthenticated" };
    t.needs.current = { list: true, rounds: [] };
    t.changeNeeds(t.needs.current);
    t.sync.refreshAll("resident");

    // When
    first.resolve(true);
    await flush();

    // Then
    expect(t.refreshAll.mock.calls.map(([options]) => options)).toEqual([
      { waitForList: false },
      { waitForList: true },
    ]);
    expect(t.counts).toEqual([1]);
  });
});

describe("ラウンドごとの取り直し", () => {
  it("開いたときの依頼は、オフラインでも取り直す", async () => {
    // Given
    const t = setup();
    t.network.offline = true;
    t.needs.current = { list: false, rounds: [roundNeed("r1", "open")] };

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
      offline.needs.current = {
        list: false,
        rounds: [roundNeed("r1", reason)],
      };
      const online = setup();
      online.needs.current = { list: false, rounds: [roundNeed("r1", reason)] };

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
    t.needs.current = { list: false, rounds: [roundNeed("r1", "overlay")] };
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds({ list: false, rounds: [roundNeed("r1", "overlay")] });
    await flush();
    t.changeNeeds({ list: false, rounds: [roundNeed("r1", "diverged")] });
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  it("効かなかった結果(diverged)は、理由が同じでも知らせるたびに取り直しを求める", async () => {
    // Given
    const t = setup();
    t.needs.current = { list: false, rounds: [roundNeed("r1", "diverged")] };
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds({ list: false, rounds: [roundNeed("r1", "diverged")] });
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  it("取り直しの最中に効かなかった結果の知らせが重ねて届いても、完了後に1回だけやり直す", async () => {
    // Given
    const t = setup();
    const running = Promise.withResolvers<"ok">();
    t.refreshRound.mockReturnValueOnce(running.promise);
    const diverged: Needs = {
      list: false,
      rounds: [roundNeed("r1", "diverged")],
    };
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
    t.needs.current = { list: false, rounds: [roundNeed("r1", "diverged")] };
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds({ list: false, rounds: [roundNeed("r1", "overlay")] });
    t.changeNeeds({ list: false, rounds: [roundNeed("r1", "diverged")] });
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
    t.needs.current = { list: false, rounds: [roundNeed("r1", "open")] };
    t.sync.start("user-1");
    await flush();

    // When
    t.changeNeeds({ list: false, rounds: [roundNeed("r1", "diverged")] });
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  describe("端末のベースで開いている間", () => {
    const staleNeeds = (): Needs => ({
      list: false,
      rounds: [roundNeed("r1", "stale")],
    });

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
      t.changeNeeds({ list: false, rounds: [] });
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
      t.needs.current = {
        list: false,
        rounds: [roundNeed("quiet", "overlay")],
      };
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
      t.needs.current = { list: false, rounds: [roundNeed("r1", "diverged")] };
      t.sync.start("user-1");
      await flush();
      t.changeNeeds({ list: false, rounds: [roundNeed("r1", "overlay")] });

      // When
      t.changeNeeds({ list: false, rounds: [] });
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
      t.changeNeeds({ list: false, rounds: [] });
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
      t.changeNeeds({ list: false, rounds: [] });
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
});

describe("停止の後", () => {
  it("停止の後は、依頼の変化に反応しない", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    t.sync.stop();

    // When
    t.changeNeeds({ list: true, rounds: [roundNeed("r1", "open")] });
    await flush();

    // Then
    expect(t.refreshAll).not.toHaveBeenCalled();
    expect(t.refreshRound).not.toHaveBeenCalled();
  });
});
