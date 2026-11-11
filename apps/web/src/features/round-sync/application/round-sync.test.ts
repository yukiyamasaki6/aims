import { describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import type {
  RoundRecordControl,
  RoundRefreshControl,
} from "@/features/rounds";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createRoundSync } from "./round-sync";

type Needs = ReturnType<RoundRefreshControl["refreshNeeds"]>;
type Reading = Awaited<ReturnType<SessionReader["readSession"]>>;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// 同期の手続きは、いつ取得して反映し、いつ取り直すかを決める。記録の制御、取り直しの制御、サインインの確認、通信の可否は約束で差し替える。
function setup(options: { reading?: Reading; same?: boolean } = {}) {
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
  const refreshRound = vi.fn(async (_roundId: string): Promise<void> => {});
  const same = options.same ?? true;
  const control = {
    start: vi.fn((_userId: string | null) => {}),
    isRecordUser: vi.fn(() => same),
    signInChanged: vi.fn(),
  } satisfies RoundRecordControl;
  const refresh = {
    refreshNeeds: () => needs.current,
    onRefreshNeeds: vi.fn((listener: () => void) => {
      notifyNeeds = listener;
    }),
    refreshAll,
    refreshRound,
  } satisfies RoundRefreshControl;
  const session: Pick<SessionReader, "readSession"> & { reading: Reading } = {
    reading:
      options.reading ??
      ({ status: "authenticated", userId: "user-1" } as Reading),
    readSession: vi.fn(async (): Promise<Reading> => session.reading),
  };
  const sync = createRoundSync({ control, refresh, session, connectivity });
  return {
    sync,
    network,
    needs,
    control,
    refresh,
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

// 取り直しの要否。真の理由だけを指定する。
const roundNeed = (
  roundId: string,
  reasons: { diverged?: boolean; overlay?: boolean },
): Needs["rounds"][number] => ({
  roundId,
  diverged: false,
  overlay: false,
  ...reasons,
});

const DIVERGED = { diverged: true } as const;
const OVERLAY = { overlay: true } as const;

describe("開始", () => {
  it("開始で記録の制御を始める", () => {
    // Given
    const t = setup();

    // When
    t.sync.start("user-1");

    // Then
    expect(t.control.start).toHaveBeenCalledExactlyOnceWith("user-1");
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

  it("開始の時点では取り直しの要否を見直さない(最初の知らせで見直す)", async () => {
    // Given
    const t = setup();
    t.needs.current = needsOf([roundNeed("r1", DIVERGED)]);

    // When
    t.sync.start("user-1");
    await flush();
    const afterStart = t.refreshRound.mock.calls.length;
    t.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));
    await flush();

    // Then
    expect(afterStart).toBe(0);
    expect(t.refreshRound).toHaveBeenCalledTimes(1);
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
    ["未認証", { status: "unauthenticated" } as Reading, true],
    ["認証が不明", { status: "unknown" } as Reading, true],
    [
      "記録の利用者と違う",
      { status: "authenticated", userId: "user-1" } as Reading,
      false,
    ],
  ] as const)(
    "%sのときは、開始でも取得しない",
    async (_name, reading, same) => {
      // Given
      const t = setup({ reading, same });

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

describe("効かなかった結果(diverged)の取り直し", () => {
  it("オフラインでは行わず、オンラインでは行う", async () => {
    // Given
    const offline = setup();
    offline.network.offline = true;
    const online = setup();
    offline.sync.start("user-1");
    online.sync.start("user-1");

    // When
    offline.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));
    online.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));
    await flush();

    // Then
    expect(offline.refreshRound).not.toHaveBeenCalled();
    expect(online.refreshRound).toHaveBeenCalledExactlyOnceWith("r1");
  });

  it("理由が同じでも、知らせるたびに取り直しを求める", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    t.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));
    await flush();

    // When
    t.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  it("取り直しの最中に知らせが重ねて届いても、完了後に1回だけやり直す", async () => {
    // Given
    const t = setup();
    const running = Promise.withResolvers<void>();
    t.refreshRound.mockReturnValueOnce(running.promise);
    t.sync.start("user-1");
    t.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));
    await flush();

    // When
    t.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));
    t.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));
    const whileRunning = t.refreshRound.mock.calls.length;
    running.resolve();
    await flush();

    // Then
    expect(whileRunning).toBe(1);
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  it("予約された取り直しは、取り直しが要らなくなっていると、完了後にやり直さない", async () => {
    // Given
    const t = setup();
    const running = Promise.withResolvers<void>();
    t.refreshRound.mockReturnValueOnce(running.promise);
    t.sync.start("user-1");
    t.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));
    await flush();
    t.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));

    // When
    t.changeNeeds(needsOf());
    running.resolve();
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledTimes(1);
  });

  it("予約された取り直しは、オフラインになっていると、完了後にやり直さない", async () => {
    // Given
    const t = setup();
    const running = Promise.withResolvers<void>();
    t.refreshRound.mockReturnValueOnce(running.promise);
    t.sync.start("user-1");
    t.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));
    await flush();
    t.changeNeeds(needsOf([roundNeed("r1", DIVERGED)]));

    // When
    t.network.offline = true;
    running.resolve();
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledTimes(1);
  });
});

describe("重ねられなかった操作(overlay)の取り直し", () => {
  it("新しく当たったときだけ取り直し、続く間の知らせでは重ねない", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");

    // When
    t.changeNeeds(needsOf([roundNeed("r1", OVERLAY)]));
    await flush();
    t.changeNeeds(needsOf([roundNeed("r1", OVERLAY)]));
    t.changeNeeds(needsOf([roundNeed("r1", OVERLAY)]));
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledTimes(1);
  });

  it("外れてまた当たると、新しく当たったものとして1回取り直す", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    t.changeNeeds(needsOf([roundNeed("r1", OVERLAY)]));
    await flush();

    // When
    t.changeNeeds(needsOf());
    await flush();
    const whileGone = t.refreshRound.mock.calls.length;
    t.changeNeeds(needsOf([roundNeed("r1", OVERLAY)]));
    await flush();

    // Then
    expect(whileGone).toBe(1);
    expect(t.refreshRound).toHaveBeenCalledTimes(2);
  });

  it("効かなかった結果と同時に当たっても、取り直しは1回で足り、効かなかった結果が外れた後に重ねて取り直さない", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");

    // When
    t.changeNeeds(needsOf([roundNeed("r1", { ...DIVERGED, ...OVERLAY })]));
    await flush();
    const afterBoth = t.refreshRound.mock.calls.length;
    t.changeNeeds(needsOf([roundNeed("r1", OVERLAY)]));
    await flush();

    // Then
    expect(afterBoth).toBe(1);
    expect(t.refreshRound).toHaveBeenCalledTimes(1);
  });

  it("取り直しの後もoverlayが残る間は、次の知らせで重ねて取り直さない", async () => {
    // Given
    const t = setup();
    t.sync.start("user-1");
    t.changeNeeds(needsOf([roundNeed("r1", OVERLAY)]));
    await flush();

    // When
    t.changeNeeds(needsOf([roundNeed("r1", OVERLAY)]));
    await flush();

    // Then
    expect(t.refreshRound).toHaveBeenCalledTimes(1);
  });

  it("オフラインでは取り直さない。当たったことは数え、オンラインに戻っても同じ知らせでは取り直さない", async () => {
    // Given
    const t = setup();
    t.network.offline = true;
    t.sync.start("user-1");
    t.changeNeeds(needsOf([roundNeed("r1", OVERLAY)]));
    await flush();

    // When
    t.network.offline = false;
    t.changeNeeds(needsOf([roundNeed("r1", OVERLAY)]));
    await flush();

    // Then
    expect(t.refreshRound).not.toHaveBeenCalled();
  });
});
