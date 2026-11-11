import { describe, expect, it, vi } from "vitest";
import { roundUpdated } from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import { createRoundBaseRefreshing } from "./round-base-refreshing";
import type { RoundFetching } from "./round-fetching";
import { createTestRoundHub } from "./round-record-test-helpers";
import { createRoundRefreshControl } from "./round-refresh-control";
import type { RoundWindow } from "./round-window";

const STREAM = roundStreamId("round-1");
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const unfitResult = {
  revision: null,
  applied: false,
  appliedFields: null,
  hasRejectedFields: false,
};

// 窓口の準備完了の詳細は、テストが与える。窓口の中身は窓口のテストで確かめる。
function fakeWindow() {
  const ready = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  const roundWindow: Pick<RoundWindow, "readyRounds" | "onReadyChange"> = {
    readyRounds: () =>
      [...ready].map(([roundId, overlay]) => ({ roundId, overlay })),
    onReadyChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    roundWindow,
    // 準備完了の詳細を設定し、購読者へ知らせる。
    setReady(roundId: string, overlay: boolean) {
      ready.set(roundId, overlay);
      for (const listener of [...listeners]) listener();
    },
  };
}

// 結線(他の機能へ公開する平らな値への写し)が検証対象。取得の中身は別のテストで確かめるため、取得の約束を差し替える。
async function setup() {
  const { hub, store } = createTestRoundHub();
  hub.start("user-1");
  await hub.ready();
  const fake = fakeWindow();
  const fetching = {
    fetchRoundDetails: vi.fn(),
    fetchRoundDetail: vi.fn(),
  };
  const control = createRoundRefreshControl({
    hub,
    roundWindow: fake.roundWindow,
    refresh: createRoundBaseRefreshing({
      hub,
      fetching: fetching as unknown as RoundFetching,
    }),
  });
  return { hub, store, fake, fetching, control };
}

// 取り直しの要否の期待値。真の理由だけを指定する。
function needOf(
  roundId: string,
  reasons: { diverged?: boolean; overlay?: boolean },
) {
  return { roundId, diverged: false, overlay: false, ...reasons };
}

// 効かなかった結果の印を、そのラウンドの列に付ける。
async function markDiverged(
  hub: Awaited<ReturnType<typeof setup>>["hub"],
  roundId: string,
) {
  const stream = roundStreamId(roundId);
  await hub.append(stream, roundUpdated({ eventId: `d-${roundId}` }));
  hub.applySendResults(stream, [`d-${roundId}`], [unfitResult]);
}

describe("理由の導出", () => {
  it("準備完了の詳細のうち、当たる理由があるものを、ラウンドごとの真偽で返す", async () => {
    // Given
    const { hub, fake, control } = await setup();
    fake.setReady("r-quiet", false);
    await markDiverged(hub, "r-diverged");
    fake.setReady("r-diverged", false);
    fake.setReady("r-overlay", true);
    await markDiverged(hub, "r-both");
    fake.setReady("r-both", true);

    // When
    const { rounds } = control.refreshNeeds();

    // Then
    expect(rounds).toHaveLength(3);
    expect(rounds).toEqual(
      expect.arrayContaining([
        needOf("r-diverged", { diverged: true }),
        needOf("r-overlay", { overlay: true }),
        needOf("r-both", { diverged: true, overlay: true }),
      ]),
    );
  });

  it("準備完了でない詳細は、効かなかった印があっても含めない", async () => {
    // Given
    const { hub, control } = await setup();
    await markDiverged(hub, "r-closed");

    // When
    const { rounds } = control.refreshNeeds();

    // Then
    expect(rounds).toEqual([]);
  });
});

describe("refreshNeeds", () => {
  it("効かなかった印が外れるとdivergedが、重ねられるようになるとoverlayが偽になる", async () => {
    // Given
    const { hub, fake, control } = await setup();
    const stream = roundStreamId("r-1");
    await hub.append(stream, roundUpdated({ eventId: "d" }));
    hub.applySendResults(stream, ["d"], [unfitResult]);
    fake.setReady("r-1", true);
    const reasons = () => control.refreshNeeds().rounds;

    // When
    const first = reasons();
    hub.clearDiverged(stream);
    const second = reasons();
    fake.setReady("r-1", false);
    const third = reasons();

    // Then
    expect(first).toEqual([needOf("r-1", { diverged: true, overlay: true })]);
    expect(second).toEqual([needOf("r-1", { overlay: true })]);
    expect(third).toEqual([]);
  });

  describe("取り直しの開始", () => {
    async function withDivergedMark() {
      const tab = await setup();
      const stream = roundStreamId("r-1");
      await tab.hub.append(stream, roundUpdated({ eventId: "d" }));
      tab.hub.applySendResults(stream, ["d"], [unfitResult]);
      tab.fake.setReady("r-1", false);
      const detailFetch = Promise.withResolvers<{
        status: "error";
        reason: "failed";
      }>();
      tab.fetching.fetchRoundDetail.mockReturnValueOnce(detailFetch.promise);
      const before = tab.control.refreshNeeds().rounds;
      const refreshing = tab.control.refreshRound("r-1");
      await flush();
      return { ...tab, detailFetch, refreshing, before };
    }

    it("取り直しを始めると、取得が終わる前に効かなかった印が消える", async () => {
      // Given
      const { control, before } = await withDivergedMark();

      // When
      const during = control.refreshNeeds().rounds;

      // Then
      expect(before).toEqual([needOf("r-1", { diverged: true })]);
      expect(during).toEqual([]);
    });

    it("取得が失敗しても、効かなかった印は戻らない", async () => {
      // Given
      const { control, detailFetch, refreshing } = await withDivergedMark();

      // When
      detailFetch.resolve({ status: "error", reason: "failed" });
      await refreshing;

      // Then
      expect(control.refreshNeeds().rounds).toEqual([]);
    });
  });

  it("準備完了の詳細や記録が変わったら通知する", async () => {
    // Given
    const { hub, fake, control } = await setup();
    const listener = vi.fn();
    control.onRefreshNeeds(listener);

    // When
    fake.setReady("r-1", false);
    await hub.append(STREAM, roundUpdated());

    // Then
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("取得と反映", () => {
  it("refreshAllは一括を、refreshRoundは1つのラウンドを取得する", async () => {
    // Given
    const { fetching, control } = await setup();
    fetching.fetchRoundDetails.mockResolvedValue({
      status: "ok",
      data: { rounds: new Map(), startedAt: 1, userId: "user-1" },
    });
    fetching.fetchRoundDetail.mockResolvedValue({
      status: "not-found",
      startedAt: 1,
      userId: "user-1",
    });

    // When
    await control.refreshAll();
    await control.refreshRound("round-1");

    // Then
    expect(fetching.fetchRoundDetails).toHaveBeenCalledTimes(1);
    expect(fetching.fetchRoundDetail).toHaveBeenCalledWith("round-1");
  });
});
