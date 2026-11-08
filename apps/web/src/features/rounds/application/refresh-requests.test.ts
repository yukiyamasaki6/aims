import { describe, expect, it, vi } from "vitest";
import { roundBase } from "../domain/round-op-test-helpers";
import { createRefreshRequests, type OpenedRound } from "./refresh-requests";
import { settleRoundNow } from "./round-record-test-helpers";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await flush();
  return done;
}

const opened = (deleted = false): OpenedRound => ({
  deleted,
  base: roundBase().tables,
  targetFaces: [],
});

describe("詳細を開く依頼", () => {
  it("取り直しが結果を返すまで解決せず、返すと待つ全ての依頼へ同じ結果を返す", async () => {
    // Given
    const requests = createRefreshRequests();
    const first = requests.open("r-1");
    const second = requests.open("r-1");

    // When
    const beforeSettle = await settled(first);
    settleRoundNow(requests, "r-1", { status: "ok", data: opened() });

    // Then
    expect(beforeSettle).toBe(false);
    expect(await first).toEqual({ status: "ok", data: opened() });
    expect(await second).toEqual({ status: "ok", data: opened() });
    expect(requests.pendingOpens()).toEqual([]);
  });

  it("結果の種類を、取り直しの結果として記録する。削除と見つからないはgone、失敗はfailed", () => {
    // Given
    const requests = createRefreshRequests();

    // When
    settleRoundNow(requests, "ok", { status: "ok", data: opened() });
    settleRoundNow(requests, "deleted", { status: "ok", data: opened(true) });
    settleRoundNow(requests, "missing", { status: "not-found" });
    settleRoundNow(requests, "offline", { status: "offline" });
    settleRoundNow(requests, "error", { status: "error", reason: "failed" });

    // Then
    expect(
      ["ok", "deleted", "missing", "offline", "error"].map((id) =>
        requests.outcomeOf(id),
      ),
    ).toEqual(["ok", "gone", "gone", "failed", "failed"]);
  });

  it("開く依頼を出すと、以前の結果の記録を消し、依頼の変化を知らせる", () => {
    // Given
    const requests = createRefreshRequests();
    settleRoundNow(requests, "r-1", { status: "offline" });
    const listener = vi.fn();
    requests.subscribe(listener);

    // When
    void requests.open("r-1");

    // Then
    expect(requests.outcomeOf("r-1")).toBeUndefined();
    expect(requests.pendingOpens()).toEqual(["r-1"]);
    expect(listener).toHaveBeenCalled();
  });
});

describe("開いている詳細の印", () => {
  it("開いている間の印を付ける。外すと消え、2回外しても数を崩さない", () => {
    // Given
    const requests = createRefreshRequests();
    const listener = vi.fn();
    requests.subscribe(listener);

    // When
    const first = requests.watch("r-1");
    const second = requests.watch("r-1");
    const both = requests.watched();
    first();
    first();
    const afterFirst = requests.watched();
    second();

    // Then
    expect(both).toEqual([{ roundId: "r-1" }]);
    expect(afterFirst).toEqual([{ roundId: "r-1" }]);
    expect(requests.watched()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("重ねられなかった確定済みの操作の印は、変わったときだけ知らせる", () => {
    // Given
    const requests = createRefreshRequests();
    const listener = vi.fn();
    requests.subscribe(listener);

    // When
    requests.setOverlay("r-1", true);
    requests.setOverlay("r-1", true);
    const needed = requests.overlayNeeded("r-1");
    requests.setOverlay("r-1", false);
    requests.setOverlay("r-1", false);

    // Then
    expect(needed).toBe(true);
    expect(requests.overlayNeeded("r-1")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("購読を解除すると、依頼の変化を知らせない", () => {
    // Given
    const requests = createRefreshRequests();
    const listener = vi.fn();
    const stop = requests.subscribe(listener);
    stop();

    // When
    requests.notify();

    // Then
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("依頼の番号", () => {
  it("latestOpenRequestは、依頼が届くたびに増え、停止でも数え直さない", () => {
    // Given
    const requests = createRefreshRequests();
    const numbers = () => [
      requests.latestOpenRequest("r-1"),
      requests.latestOpenRequest("r-2"),
    ];

    // When
    const initial = numbers();
    void requests.open("r-1");
    void requests.open("r-1");
    void requests.open("r-2");
    const beforeReset = numbers();
    requests.reset();
    const afterReset = numbers();
    void requests.open("r-1");
    const afterNext = numbers();

    // Then
    expect(initial).toEqual([0, 0]);
    expect(beforeReset).toEqual([2, 1]);
    expect(afterReset).toEqual([2, 1]);
    expect(afterNext).toEqual([3, 1]);
  });
});

describe("並行する実行の結果の記録", () => {
  const results = {
    ok: { status: "ok", data: opened() },
    failed: { status: "offline" },
    gone: { status: "not-found" },
  } as const;
  type Kind = keyof typeof results;

  // 同じ開く依頼を2つの実行が取り込み、完了の順を変える。
  it.each<[Kind, Kind, "古い" | "新しい"]>([
    ["ok", "failed", "古い"],
    ["ok", "failed", "新しい"],
    ["failed", "ok", "古い"],
    ["failed", "ok", "新しい"],
    ["ok", "gone", "古い"],
    ["ok", "gone", "新しい"],
    ["gone", "ok", "古い"],
    ["gone", "ok", "新しい"],
    ["failed", "gone", "古い"],
    ["failed", "gone", "新しい"],
    ["gone", "failed", "古い"],
    ["gone", "failed", "新しい"],
  ])(
    "古い実行が%s、新しい実行が%sで、%sが先に終わっても、開く依頼は先に終わった実行の結果で1回だけ解決し、後に始めた実行の結果を先に始めた実行の結果で上書きしない",
    async (olderKind, newerKind, first) => {
      // Given
      const requests = createRefreshRequests();
      const request = requests.open("r-1");
      const older = requests.beginRound("r-1");
      const newer = requests.beginRound("r-1");
      const resolved: unknown[] = [];
      void request.then((result) => resolved.push(result));
      const settle = (which: "古い" | "新しい") =>
        which === "古い"
          ? requests.settleRound(older, results[olderKind])
          : requests.settleRound(newer, results[newerKind]);

      // When
      settle(first);
      settle(first === "古い" ? "新しい" : "古い");
      await flush();

      // Then
      const firstKind = first === "古い" ? olderKind : newerKind;
      expect(resolved).toEqual([results[firstKind]]);
      const expected = { ok: "ok", failed: "failed", gone: "gone" } as const;
      expect(requests.outcomeOf("r-1")).toBe(expected[newerKind]);
    },
  );

  it("別のラウンドは、実行の番号を共有しない", () => {
    // Given
    const requests = createRefreshRequests();
    void requests.open("r-1");
    void requests.open("r-2");
    const first = requests.beginRound("r-1");
    const second = requests.beginRound("r-1");
    requests.settleRound(second, results.ok);
    requests.settleRound(first, results.ok);
    const other = requests.beginRound("r-2");

    // When
    requests.settleRound(other, results.gone);

    // Then
    expect(requests.outcomeOf("r-2")).toBe("gone");
  });

  it("先に始めた実行が先に終わると、結果は記録せず依頼を解決し、後に始めた実行が終わると記録する", async () => {
    // Given
    const requests = createRefreshRequests();
    const request = requests.open("r-1");
    const earlier = requests.beginRound("r-1");
    const later = requests.beginRound("r-1");
    const resolved: unknown[] = [];
    void request.then((result) => resolved.push(result));

    // When
    requests.settleRound(earlier, results.gone);
    await flush();
    const afterEarlier = requests.outcomeOf("r-1");
    requests.settleRound(later, results.ok);
    await flush();

    // Then
    expect(afterEarlier).toBeUndefined();
    expect(resolved).toEqual([results.gone]);
    expect(requests.outcomeOf("r-1")).toBe("ok");
  });

  it("結果の記録か待ちの解決があったときだけ変化を知らせる。先に始めた実行が先に終わると1回、後に始めた実行が終わると2回目", () => {
    // Given
    const requests = createRefreshRequests();
    void requests.open("r-1");
    const earlier = requests.beginRound("r-1");
    const later = requests.beginRound("r-1");
    const listener = vi.fn();
    requests.subscribe(listener);

    // When
    requests.settleRound(earlier, results.gone);
    const afterEarlier = listener.mock.calls.length;
    requests.settleRound(later, results.ok);

    // Then
    expect(afterEarlier).toBe(1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("後に始めた実行が記録した後の、先に始めた実行の終わりは、何も変えず変化を知らせない", async () => {
    // Given
    const requests = createRefreshRequests();
    const request = requests.open("r-1");
    const earlier = requests.beginRound("r-1");
    const later = requests.beginRound("r-1");
    const resolved: unknown[] = [];
    void request.then((result) => resolved.push(result));
    requests.settleRound(later, results.ok);
    await flush();
    const listener = vi.fn();
    requests.subscribe(listener);

    // When
    requests.settleRound(earlier, results.gone);
    await flush();

    // Then
    expect(listener).not.toHaveBeenCalled();
    expect(requests.outcomeOf("r-1")).toBe("ok");
    expect(resolved).toEqual([results.ok]);
  });

  it("停止の後は、停止前の実行の番号に妨げられず、再開後の結果が記録される", () => {
    // Given
    const requests = createRefreshRequests();
    void requests.open("r-1");
    const earlier = requests.beginRound("r-1");
    const later = requests.beginRound("r-1");
    requests.settleRound(later, results.ok);
    requests.settleRound(earlier, results.ok);
    const before = requests.outcomeOf("r-1");
    requests.reset();

    // When
    void requests.open("r-1");
    const run = requests.beginRound("r-1");
    requests.settleRound(run, results.gone);

    // Then
    expect(before).toBe("ok");
    expect(requests.outcomeOf("r-1")).toBe("gone");
  });
});

describe("依頼の状態の遷移", () => {
  const ok = { status: "ok", data: opened() } as const;

  it("同じラウンドの重複した開く依頼は、同じ取得の結果で全て完了する", async () => {
    // Given
    const requests = createRefreshRequests();
    const first = requests.open("r-1");
    const second = requests.open("r-1");

    // When
    requests.settleRound(requests.beginRound("r-1"), ok);

    // Then
    expect(await first).toEqual(ok);
    expect(await second).toEqual(ok);
    expect(requests.pendingOpens()).toEqual([]);
  });

  it("取得の開始後に出された開く依頼は、完了後も待ちとして残る", async () => {
    // Given
    const requests = createRefreshRequests();
    void requests.open("r-1");
    const run = requests.beginRound("r-1");
    const later = requests.open("r-1");

    // When
    requests.settleRound(run, ok);

    // Then
    expect(requests.pendingOpens()).toEqual(["r-1"]);
    expect(await settled(later)).toBe(false);
  });

  it("停止は、待っている開く依頼をエラーで終える", async () => {
    // Given
    const requests = createRefreshRequests();
    const open = requests.open("r-1");

    // When
    requests.reset();

    // Then
    expect(await open).toEqual({ status: "error", reason: "failed" });
    expect(requests.pendingOpens()).toEqual([]);
  });

  it("停止前に始まった取り直しの完了は、結果の記録・待ち・通知のどれも変えない", async () => {
    // Given
    const requests = createRefreshRequests();
    void requests.open("r-1");
    const stale = requests.beginRound("r-1");
    requests.reset();
    const resumed = requests.open("r-1");
    const listener = vi.fn();
    requests.subscribe(listener);

    // When
    requests.settleRound(stale, ok);

    // Then
    expect(requests.outcomeOf("r-1")).toBeUndefined();
    expect(requests.pendingOpens()).toEqual(["r-1"]);
    expect(await settled(resumed)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("再開後の開く依頼は新しい依頼として、新しい取得の結果で完了する", async () => {
    // Given
    const requests = createRefreshRequests();
    void requests.open("r-1");
    requests.reset();
    const resumed = requests.open("r-1");

    // When
    requests.settleRound(requests.beginRound("r-1"), ok);

    // Then
    expect(await resumed).toEqual(ok);
    expect(requests.outcomeOf("r-1")).toBe("ok");
  });
});
