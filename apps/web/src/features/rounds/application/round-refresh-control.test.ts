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
  rejectedFields: [],
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
  it("開いた直後、古い、効かなかった、重ねられなかったの順に先に当たる理由をreasonとして返す", async () => {
    // Given
    const { hub, requests, control } = await setup();
    void requests.open("r-open");
    requests.watch("r-open", true);
    requests.watch("r-stale", true);
    await markDiverged(hub, "r-diverged");
    requests.watch("r-diverged", false);
    requests.setOverlay("r-overlay", true);
    requests.watch("r-overlay", false);
    await markDiverged(hub, "r-both");
    requests.setOverlay("r-both", true);
    requests.watch("r-both", false);

    // When
    const { rounds } = control.refreshNeeds();

    // Then
    expect(rounds).toHaveLength(5);
    expect(rounds).toEqual(
      expect.arrayContaining([
        {
          roundId: "r-open",
          reason: "open",
          reasons: ["open", "stale"],
          openRequest: 1,
        },
        { roundId: "r-stale", reason: "stale", reasons: ["stale"] },
        { roundId: "r-diverged", reason: "diverged", reasons: ["diverged"] },
        { roundId: "r-overlay", reason: "overlay", reasons: ["overlay"] },
        {
          roundId: "r-both",
          reason: "diverged",
          reasons: ["diverged", "overlay"],
        },
      ]),
    );
  });

  it("当たる全ての理由を、開く依頼、古い、効かなかった、重ねられなかったの順に並べ、主の理由は先頭にする", async () => {
    // Given
    const { hub, requests, control } = await setup();
    void requests.open("r-open-all");
    requests.watch("r-open-all", true);
    await markDiverged(hub, "r-open-all");
    requests.setOverlay("r-open-all", true);
    requests.watch("r-stale-all", true);
    await markDiverged(hub, "r-stale-all");
    requests.setOverlay("r-stale-all", true);

    // When
    const { rounds } = control.refreshNeeds();

    // Then
    expect(rounds).toHaveLength(2);
    expect(rounds).toEqual(
      expect.arrayContaining([
        {
          roundId: "r-open-all",
          reason: "open",
          reasons: ["open", "stale", "diverged", "overlay"],
          openRequest: 1,
        },
        {
          roundId: "r-stale-all",
          reason: "stale",
          reasons: ["stale", "diverged", "overlay"],
        },
      ]),
    );
  });

  it("どの理由にも当たらない詳細は、要否に含めない", async () => {
    // Given
    const { requests, control } = await setup();
    requests.watch("r-quiet", false);

    // When
    const { rounds } = control.refreshNeeds();

    // Then
    expect(rounds).toEqual([]);
  });
});

describe("refreshNeeds", () => {
  it("一覧の依頼の有無と、取り直しが要るラウンドを理由とともに返す", async () => {
    // Given
    const { hub, requests, control } = await setup();
    void requests.open("opening");
    requests.watch("stale", true);
    requests.watch("quiet", false);
    requests.setOverlay("overlay", true);
    requests.watch("overlay", false);
    await hub.append(roundStreamId("diverged"), roundUpdated({ eventId: "d" }));
    hub.applySendResults(
      roundStreamId("diverged"),
      ["d"],
      [
        {
          revision: null,
          applied: false,
          appliedFields: null,
          rejectedFields: [],
        },
      ],
    );
    requests.watch("diverged", false);
    requests.requestAll();

    // When
    const needs = control.refreshNeeds();

    // Then
    expect(needs.list).toBe(true);
    expect(needs.rounds).toEqual(
      expect.arrayContaining([
        {
          roundId: "opening",
          reason: "open",
          reasons: ["open"],
          openRequest: 1,
        },
        { roundId: "stale", reason: "stale", reasons: ["stale"] },
        { roundId: "overlay", reason: "overlay", reasons: ["overlay"] },
        { roundId: "diverged", reason: "diverged", reasons: ["diverged"] },
      ]),
    );
    expect(needs.rounds.map((need) => need.roundId)).not.toContain("quiet");
  });

  it("refreshNeedsは、理由がopenのラウンドにだけopenRequestを付け、一覧の依頼の番号を添える", async () => {
    // Given
    const { requests, control } = await setup();
    void requests.open("r-1");
    void requests.open("r-1");
    requests.watch("r-2", true);
    requests.requestAll();

    // When
    const needs = control.refreshNeeds();

    // Then
    expect(needs.listRequest).toBe(1);
    expect(needs.rounds).toEqual(
      expect.arrayContaining([
        { roundId: "r-1", reason: "open", reasons: ["open"], openRequest: 2 },
        { roundId: "r-2", reason: "stale", reasons: ["stale"] },
      ]),
    );
    const stale = needs.rounds.find((need) => need.roundId === "r-2");
    expect(stale && Object.hasOwn(stale, "openRequest")).toBe(false);
  });

  it("理由は、開く依頼、端末のベースで開いた詳細の古さ、効かなかった印、重ねられなかった印の順に先のものが返り、先の理由が無くなると次のものが返る", async () => {
    // Given
    const { hub, requests, control } = await setup();
    const stream = roundStreamId("r-1");
    void requests.open("r-1");
    requests.watch("r-1", true);
    await hub.append(stream, roundUpdated({ eventId: "d" }));
    hub.applySendResults(stream, ["d"], [unfitResult]);
    requests.setOverlay("r-1", true);
    const reasons = () => control.refreshNeeds().rounds;

    // When
    const first = reasons();
    // settleRoundNowは取り直しの開始で効かなかった印を消さないため、順を保てる。
    settleRoundNow(requests, "r-1", { status: "error", message: "x" });
    const second = reasons();
    settleRoundNow(requests, "r-1", {
      status: "ok",
      data: { deleted: false, base: roundBase().tables, targetFaces: [] },
    });
    const third = reasons();
    hub.clearDiverged(stream);
    const fourth = reasons();
    requests.setOverlay("r-1", false);
    const fifth = reasons();

    // Then
    expect(first).toEqual([
      {
        roundId: "r-1",
        reason: "open",
        reasons: ["open", "stale", "diverged", "overlay"],
        openRequest: 1,
      },
    ]);
    expect(second).toEqual([
      {
        roundId: "r-1",
        reason: "stale",
        reasons: ["stale", "diverged", "overlay"],
      },
    ]);
    expect(third).toEqual([
      { roundId: "r-1", reason: "diverged", reasons: ["diverged", "overlay"] },
    ]);
    expect(fourth).toEqual([
      { roundId: "r-1", reason: "overlay", reasons: ["overlay"] },
    ]);
    expect(fifth).toEqual([]);
  });

  it("端末のベースで開いた詳細に効かなかった印が付くと、主の理由はstaleのまま、reasonsにdivergedが加わる", async () => {
    // Given
    const { hub, requests, control } = await setup();
    const stream = roundStreamId("r-1");
    requests.watch("r-1", true);
    await hub.append(stream, roundUpdated({ eventId: "d" }));
    hub.applySendResults(stream, ["d"], [unfitResult]);

    // When
    const needs = control.refreshNeeds();

    // Then
    expect(needs.rounds).toEqual([
      { roundId: "r-1", reason: "stale", reasons: ["stale", "diverged"] },
    ]);
  });

  describe("取り直しの開始", () => {
    async function withDivergedMark() {
      const tab = await setup();
      const stream = roundStreamId("r-1");
      await tab.hub.append(stream, roundUpdated({ eventId: "d" }));
      tab.hub.applySendResults(stream, ["d"], [unfitResult]);
      tab.requests.watch("r-1", false);
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
      expect(before).toEqual([
        { roundId: "r-1", reason: "diverged", reasons: ["diverged"] },
      ]);
      expect(during).toEqual([]);
    });

    it("取得が失敗しても、効かなかった印は戻らない", async () => {
      // Given
      const { control, detailFetch, refreshing } = await withDivergedMark();

      // When
      detailFetch.resolve({ status: "error", message: "x" });
      const result = await refreshing;

      // Then
      expect(result).toBe("failed");
      expect(control.refreshNeeds().rounds).toEqual([]);
    });
  });

  it("端末のベースで開いた詳細が取り直しで成功すると、古い理由から外れる", async () => {
    // Given
    const { requests, control } = await setup();
    requests.watch("stale", true);

    // When
    settleRoundNow(requests, "stale", {
      status: "ok",
      data: { deleted: false, base: roundBase().tables, targetFaces: [] },
    });

    // Then
    expect(control.refreshNeeds().rounds).toEqual([]);
  });

  it("依頼や記録が変わったら通知し、解除すると両方の通知が止まる", async () => {
    // Given
    const { hub, requests, control } = await setup();
    const listener = vi.fn();
    const stop = control.onRefreshNeeds(listener);

    // When
    requests.notify();
    await hub.append(STREAM, roundUpdated());
    const whileSubscribed = listener.mock.calls.length;
    stop();
    requests.notify();
    await hub.append(STREAM, roundUpdated({ eventId: "again" }));

    // Then
    expect(whileSubscribed).toBeGreaterThanOrEqual(2);
    expect(listener).toHaveBeenCalledTimes(whileSubscribed);
  });
});

describe("取得と反映", () => {
  it("refreshAllは、反映したかを返し、refreshRoundは結果の種類を返す", async () => {
    // Given
    const { fetching, control } = await setup();
    fetching.fetchRoundDetails.mockResolvedValue({
      status: "ok",
      data: { rounds: new Map(), startedAt: 1, userId: "user-1" },
    });
    fetching.fetchRoundDetail.mockResolvedValue({ status: "not-found" });

    // When
    const committed = await control.refreshAll({ waitForList: false });
    const round = await control.refreshRound("round-1");

    // Then
    expect(committed).toBe(true);
    expect(round).toBe("gone");
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
      { roundId: "r-1", reason: "open", reasons: ["open"], openRequest: 2 },
    ]);
  });
});
