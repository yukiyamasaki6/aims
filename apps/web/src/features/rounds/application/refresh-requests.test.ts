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

const opened = (): OpenedRound => ({
  base: roundBase().tables,
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

  it("取り直しでラウンドが見つからなかったときだけ、見つからなかった記録を残す", () => {
    // Given
    const requests = createRefreshRequests();

    // When
    settleRoundNow(requests, "ok", { status: "ok", data: opened() });
    settleRoundNow(requests, "missing", { status: "not-found" });
    settleRoundNow(requests, "offline", { status: "offline" });
    settleRoundNow(requests, "error", { status: "error", reason: "failed" });

    // Then
    expect(
      ["ok", "missing", "offline", "error"].map((id) => requests.isGone(id)),
    ).toEqual([false, true, false, false]);
  });

  it("開く依頼を出すと、以前の結果の記録を消し、依頼の変化を知らせる", () => {
    // Given
    const requests = createRefreshRequests();
    settleRoundNow(requests, "r-1", { status: "not-found" });
    const listener = vi.fn();
    requests.subscribe(listener);

    // When
    void requests.open("r-1");

    // Then
    expect(requests.isGone("r-1")).toBe(false);
    expect(requests.pendingOpens()).toEqual(["r-1"]);
    expect(listener).toHaveBeenCalled();
  });
});

describe("開いている詳細の印", () => {
  it("印を付けると開いているラウンドに出て、外すと消える。付ける時と外す時に知らせる", () => {
    // Given
    const requests = createRefreshRequests();
    const listener = vi.fn();
    requests.subscribe(listener);

    // When
    const unwatch = requests.watch("r-1");
    const watching = requests.watched();
    unwatch();

    // Then
    expect(watching).toEqual([{ roundId: "r-1" }]);
    expect(requests.watched()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
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
    void requests.open("r-1");
    requests.setOverlay("r-1", true);

    // Then
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("的が足りない印", () => {
  it("印が1つでもあれば真で、全て外れると偽になる。キーごとに数える", () => {
    // Given
    const requests = createRefreshRequests();

    // When
    requests.wantFaces("a", true);
    requests.wantFaces("b", true);
    requests.wantFaces("a", false);
    const whileOne = requests.facesWanted();
    requests.wantFaces("b", false);

    // Then
    expect(whileOne).toBe(true);
    expect(requests.facesWanted()).toBe(false);
  });

  it("印が変わったときだけ知らせる", () => {
    // Given
    const requests = createRefreshRequests();
    const listener = vi.fn();
    requests.subscribe(listener);

    // When
    requests.wantFaces("a", true);
    requests.wantFaces("a", true);
    requests.wantFaces("a", false);
    requests.wantFaces("a", false);

    // Then
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("的の保存を知らせると、購読者を呼ぶ", () => {
    // Given
    const requests = createRefreshRequests();
    const listener = vi.fn();
    requests.subscribe(listener);

    // When
    requests.facesSaved();

    // Then
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("依頼の番号", () => {
  it("latestOpenRequestは、依頼が届くたびに増える", () => {
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
    const afterThree = numbers();
    void requests.open("r-1");
    const afterNext = numbers();

    // Then
    expect(initial).toEqual([0, 0]);
    expect(afterThree).toEqual([2, 1]);
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
    "古い実行が%s、新しい実行が%sで、%sが先に終わっても、開く依頼は先に終わった実行の結果で1回だけ解決し、見つからなかったかは最後に終わった実行の結果になる",
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
      const lastKind = first === "古い" ? newerKind : olderKind;
      expect(resolved).toEqual([results[firstKind]]);
      expect(requests.isGone("r-1")).toBe(lastKind === "gone");
    },
  );

  it("別のラウンドは、見つからなかった記録を共有しない", () => {
    // Given
    const requests = createRefreshRequests();
    void requests.open("r-1");
    void requests.open("r-2");
    requests.settleRound(requests.beginRound("r-1"), results.ok);
    const other = requests.beginRound("r-2");

    // When
    requests.settleRound(other, results.gone);

    // Then
    expect([requests.isGone("r-1"), requests.isGone("r-2")]).toEqual([
      false,
      true,
    ]);
  });

  it("変化を知らせるのは、待ちの解決か、見つからなかったかの変化があったときだけ", () => {
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
    requests.settleRound(later, results.gone);

    // Then
    expect(afterEarlier).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
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
});
