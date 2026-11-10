import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../domain/fetch-status";
import { roundBase, roundUpdated } from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import { createRefreshRequests } from "./refresh-requests";
import { createRoundBaseRefreshing } from "./round-base-refreshing";
import type { FetchedRoundDetail, RoundFetching } from "./round-fetching";
import {
  createTestRoundHub,
  settleRoundNow,
} from "./round-record-test-helpers";
import { createRoundRefreshControl } from "./round-refresh-control";

const STREAM = roundStreamId("round-1");
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// 取得した詳細。取り直しの結果の中身は問わない。
function fetchedDetail(): FetchedRoundDetail {
  return {
    roundConfig: {
      name: "午前練習",
      roundDate: "2026-09-15",
      format: "outdoor",
      bowType: "recurve",
    },
    status: "in_progress",
    distances: [],
    shots: [],
    targetFaces: [],
    revisions: { round: 1, distances: {}, shots: {} },
    startedAt: 100,
    userId: "user-1",
  };
}

const unfitResult = {
  revision: null,
  applied: false,
  appliedFields: null,
  hasRejectedFields: false,
};

// 結線(他の機能へ公開する平らな値への写し)が検証対象。取得の中身は別のテストで確かめるため、取得の約束を差し替える。
async function setup() {
  const { hub, store } = createTestRoundHub();
  hub.start("user-1");
  await hub.ready();
  const requests = createRefreshRequests();
  const fetching = {
    fetchRoundDetails: vi.fn(),
    fetchRoundDetail: vi.fn(),
  };
  const control = createRoundRefreshControl({
    hub,
    requests,
    refresh: createRoundBaseRefreshing({
      hub,
      requests,
      fetching: fetching as unknown as RoundFetching,
    }),
  });
  return { hub, store, requests, fetching, control };
}

// 取り直しの要否の期待値。真の理由だけを指定する。
function needOf(
  roundId: string,
  reasons: { open?: boolean; diverged?: boolean; overlay?: boolean },
  openRequest = 0,
) {
  return {
    roundId,
    open: false,
    diverged: false,
    overlay: false,
    ...reasons,
    openRequest,
  };
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
  it("当たる理由を、ラウンドごとの真偽で返す", async () => {
    // Given
    const { hub, requests, control } = await setup();
    void requests.open("r-open");
    requests.watch("r-open");
    await markDiverged(hub, "r-diverged");
    requests.watch("r-diverged");
    requests.setOverlay("r-overlay", true);
    requests.watch("r-overlay");
    await markDiverged(hub, "r-both");
    requests.setOverlay("r-both", true);
    requests.watch("r-both");

    // When
    const { rounds } = control.refreshNeeds();

    // Then
    expect(rounds).toHaveLength(4);
    expect(rounds).toEqual(
      expect.arrayContaining([
        needOf("r-open", { open: true }, 1),
        needOf("r-diverged", { diverged: true }),
        needOf("r-overlay", { overlay: true }),
        needOf("r-both", { diverged: true, overlay: true }),
      ]),
    );
  });

  it("複数の理由が当たるラウンドは、全ての理由を真にして返す", async () => {
    // Given
    const { hub, requests, control } = await setup();
    void requests.open("r-open-all");
    requests.watch("r-open-all");
    await markDiverged(hub, "r-open-all");
    requests.setOverlay("r-open-all", true);

    // When
    const { rounds } = control.refreshNeeds();

    // Then
    expect(rounds).toEqual([
      needOf("r-open-all", { open: true, diverged: true, overlay: true }, 1),
    ]);
  });

  it("どの理由にも当たらない詳細は、要否に含めない(取得に失敗していても、古さを理由にしない)", async () => {
    // Given
    const { requests, control } = await setup();
    requests.watch("r-quiet");
    void requests.open("r-failed");
    requests.watch("r-failed");
    settleRoundNow(requests, "r-failed", { status: "error", reason: "failed" });

    // When
    const { rounds } = control.refreshNeeds();

    // Then
    expect(rounds).toEqual([]);
  });
});

describe("refreshNeeds", () => {
  it("取り直しが要るラウンドを理由とともに返す", async () => {
    // Given
    const { hub, requests, control } = await setup();
    void requests.open("opening");
    requests.watch("quiet");
    requests.setOverlay("overlay", true);
    requests.watch("overlay");
    await hub.append(roundStreamId("diverged"), roundUpdated({ eventId: "d" }));
    hub.applySendResults(
      roundStreamId("diverged"),
      ["d"],
      [
        {
          revision: null,
          applied: false,
          appliedFields: null,
          hasRejectedFields: false,
        },
      ],
    );
    requests.watch("diverged");

    // When
    const needs = control.refreshNeeds();

    // Then
    expect(needs.rounds).toEqual(
      expect.arrayContaining([
        needOf("opening", { open: true }, 1),
        needOf("overlay", { overlay: true }),
        needOf("diverged", { diverged: true }),
      ]),
    );
    expect(needs.rounds.map((need) => need.roundId)).not.toContain("quiet");
  });

  it("refreshNeedsは、ラウンドごとの最後の開く依頼の番号をopenRequestに持つ", async () => {
    // Given
    const { requests, control } = await setup();
    void requests.open("r-1");
    void requests.open("r-1");
    requests.watch("r-2");
    requests.setOverlay("r-2", true);

    // When
    const needs = control.refreshNeeds();

    // Then
    expect(needs.rounds).toEqual(
      expect.arrayContaining([
        needOf("r-1", { open: true }, 2),
        needOf("r-2", { overlay: true }),
      ]),
    );
  });

  it("開く依頼が結果を受けると、openが偽になり、効かなかった印が外れるとdivergedが偽になる", async () => {
    // Given
    const { hub, requests, control } = await setup();
    const stream = roundStreamId("r-1");
    void requests.open("r-1");
    requests.watch("r-1");
    await hub.append(stream, roundUpdated({ eventId: "d" }));
    hub.applySendResults(stream, ["d"], [unfitResult]);
    requests.setOverlay("r-1", true);
    const reasons = () => control.refreshNeeds().rounds;

    // When
    const first = reasons();
    // settleRoundNowは取り直しの開始で効かなかった印を消さないため、順を保てる。
    settleRoundNow(requests, "r-1", {
      status: "ok",
      data: { deleted: false, base: roundBase().tables, targetFaces: [] },
    });
    const second = reasons();
    hub.clearDiverged(stream);
    const third = reasons();
    requests.setOverlay("r-1", false);
    const fourth = reasons();

    // Then
    expect(first).toEqual([
      needOf("r-1", { open: true, diverged: true, overlay: true }, 1),
    ]);
    expect(second).toEqual([
      needOf("r-1", { diverged: true, overlay: true }, 1),
    ]);
    expect(third).toEqual([needOf("r-1", { overlay: true }, 1)]);
    expect(fourth).toEqual([]);
  });

  describe("取り直しの開始", () => {
    async function withDivergedMark() {
      const tab = await setup();
      const stream = roundStreamId("r-1");
      await tab.hub.append(stream, roundUpdated({ eventId: "d" }));
      tab.hub.applySendResults(stream, ["d"], [unfitResult]);
      tab.requests.watch("r-1");
      const detailFetch =
        Promise.withResolvers<FetchResult<FetchedRoundDetail>>();
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

  it("依頼や記録が変わったら通知する", async () => {
    // Given
    const { hub, requests, control } = await setup();
    const listener = vi.fn();
    control.onRefreshNeeds(listener);

    // When
    requests.notify();
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
    fetching.fetchRoundDetail.mockResolvedValue({ status: "not-found" });

    // When
    await control.refreshAll();
    await control.refreshRound("round-1");

    // Then
    expect(fetching.fetchRoundDetails).toHaveBeenCalledTimes(1);
    expect(fetching.fetchRoundDetail).toHaveBeenCalledWith("round-1");
  });
  it("開始した後に出した開く依頼は、その実行の結果を受けずに待ちとして残り、openを返し続ける。開始前の依頼は結果を受ける", async () => {
    // Given
    const { requests, fetching, control } = await setup();
    const before = requests.open("r-1");
    const detailFetch =
      Promise.withResolvers<FetchResult<FetchedRoundDetail>>();
    fetching.fetchRoundDetail.mockReturnValueOnce(detailFetch.promise);
    const refreshing = control.refreshRound("r-1");
    await flush();
    const after = requests.open("r-1");
    let afterSettled = false;
    void after.then(() => {
      afterSettled = true;
    });

    // When
    detailFetch.resolve({ status: "ok", data: fetchedDetail() });
    await refreshing;
    await flush();

    // Then
    expect(await before).toMatchObject({ status: "ok" });
    expect(afterSettled).toBe(false);
    expect(control.refreshNeeds().rounds).toEqual([
      needOf("r-1", { open: true }, 2),
    ]);
  });
});
