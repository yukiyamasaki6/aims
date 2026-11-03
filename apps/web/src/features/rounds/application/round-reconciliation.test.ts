import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../domain/fetch-result";
import {
  distanceCreated,
  roundBase,
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import {
  createOperationSending,
  type RoundTransport,
} from "./operation-sending";
import { createRefreshRequests } from "./refresh-requests";
import { createRoundBaseRefreshing } from "./round-base-refreshing";
import type { FetchedRoundDetail, RoundFetching } from "./round-fetching";
import { createRoundReconciliation } from "./round-reconciliation";
import {
  createTestRoundHub,
  settleRoundNow,
} from "./round-record-test-helpers";

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

// 結線(他の機能へ公開する平らな値への写し)が検証対象。取得と送信の中身は別のテストで確かめるため、約束を差し替える。
async function setup() {
  const { hub, store } = createTestRoundHub();
  hub.start("user-1");
  await hub.ready();
  const requests = createRefreshRequests();
  const transport = { send: vi.fn() } satisfies RoundTransport;
  const fetching = {
    fetchRoundDetails: vi.fn(),
    fetchRoundDetail: vi.fn(),
  };
  const reconciliation = createRoundReconciliation({
    hub,
    requests,
    send: createOperationSending({ hub, transport }),
    refresh: createRoundBaseRefreshing({
      hub,
      requests,
      fetching: fetching as unknown as RoundFetching,
    }),
  });
  return { hub, store, requests, transport, fetching, reconciliation };
}

describe("記録の公開", () => {
  it("送る候補を、操作のID、送る単位、保存の有無、seqの有無だけの平らな値で返し、確定済みの操作は含めない", async () => {
    // Given
    const { hub, reconciliation } = await setup();
    const confirmed = roundUpdated({ eventId: "confirmed" });
    await hub.append(STREAM, confirmed);
    hub.applySendResults(
      STREAM,
      ["confirmed"],
      [{ revision: 1, applied: true, appliedFields: null, rejectedFields: [] }],
    );
    await hub.append(STREAM, shotRecorded({ eventId: "shot" }));

    // When
    const outbox = reconciliation.outbox(STREAM);

    // Then
    expect(outbox).toEqual([
      { eventId: "shot", lane: expect.any(String), saved: true, hasSeq: true },
    ]);
  });

  it("操作の衝突を、記録にある操作のIDで問える。記録に無いIDの問いは衝突なしにする", async () => {
    // Given
    const { hub, reconciliation } = await setup();
    await hub.append(STREAM, shotRecorded({ eventId: "rec" }));
    await hub.append(STREAM, shotCleared({ eventId: "clr" }));
    await hub.append(
      STREAM,
      distanceCreated({ eventId: "dist", id: "d-9", roundId: "round-1" }),
    );

    // When
    const sameShot = reconciliation.conflicts(STREAM, "rec", "clr");
    const unknown = reconciliation.conflicts(STREAM, "rec", "missing");

    // Then
    expect(sameShot).toBe(true);
    expect(unknown).toBe(false);
  });

  it("記録が変わった後は、追記した操作で衝突を判定する(古い値の索引を使わない)", async () => {
    // Given
    const { hub, reconciliation } = await setup();
    await hub.append(STREAM, shotRecorded({ eventId: "rec" }));
    await hub.append(STREAM, shotCleared({ eventId: "clr" }));
    const before = reconciliation.conflicts(STREAM, "rec", "clr");

    // When
    await hub.append(STREAM, shotCleared({ eventId: "clr2" }));
    const afterAppend = reconciliation.conflicts(STREAM, "rec", "clr2");

    // Then
    expect(before).toBe(true);
    expect(afterAppend).toBe(true);
  });

  it("利用者の照合、列の一覧、送る単位の上限を公開する", async () => {
    // Given
    const { hub, reconciliation } = await setup();
    await hub.append(STREAM, roundUpdated());

    // When
    const matches = [
      reconciliation.matchUser("user-1"),
      reconciliation.matchUser("user-2"),
    ];

    // Then
    expect(matches).toEqual(["same", "other"]);
    expect(reconciliation.streams()).toEqual([STREAM]);
    expect(reconciliation.batchLimitOf("lane")).toBeGreaterThanOrEqual(1);
  });

  it("reloadAllは、記録に無い列を端末の保存先から読んで、列の一覧に加える", async () => {
    // Given
    const { reconciliation, store } = await setup();
    // 知らせを共有しない別の記録のハブが、新しい列へ保存する。
    const other = createTestRoundHub({ store }).hub;
    other.start("user-1");
    await other.ready();
    await other.append(STREAM, roundUpdated());
    const before = reconciliation.streams();

    // When
    await reconciliation.reloadAll();

    // Then
    expect(before).toEqual([]);
    expect(reconciliation.streams()).toEqual([STREAM]);
  });

  it("利用者を替え、送信中の目印を付けて、読み直しと変化の購読を行える", async () => {
    // Given
    const { hub, reconciliation } = await setup();
    await hub.append(STREAM, roundUpdated({ eventId: "a" }));
    const changes: string[] = [];
    const stop = reconciliation.onChange((change) => changes.push(change.kind));

    // When
    reconciliation.markInFlight(STREAM, ["a"], true);
    await reconciliation.reloadStream(STREAM);
    const keptWhileSending = hub.record(STREAM).items.length;
    reconciliation.setUser("user-2");
    const afterSwitch = [
      reconciliation.matchUser("user-2"),
      reconciliation.matchUser("user-1"),
    ];
    stop();

    // Then
    expect(keptWhileSending).toBe(1);
    expect(afterSwitch).toEqual(["same", "other"]);
    expect(changes.length).toBeGreaterThan(0);
  });

  it("始めと止めは、記録の始めと止めに委譲する", async () => {
    // Given
    const { hub, reconciliation } = await setup();
    await hub.append(STREAM, roundUpdated());

    // When
    reconciliation.stop();
    const afterStop = reconciliation.streams();
    reconciliation.start("user-1");
    await hub.ready();
    const afterStart = [
      reconciliation.matchUser("user-1"),
      reconciliation.matchUser("user-2"),
    ];

    // Then
    expect(afterStop).toEqual([]);
    expect(afterStart).toEqual(["same", "other"]);
  });

  it("拒否された操作を破棄し、記録から外す", async () => {
    // Given
    const { hub, reconciliation } = await setup();
    await hub.append(STREAM, roundUpdated({ eventId: "a" }));

    // When
    await reconciliation.discard(STREAM, ["a"]);

    // Then
    expect(hub.record(STREAM).items).toEqual([]);
  });
});

describe("send", () => {
  it("成功は、効かない項目があったかだけを返す", async () => {
    // Given
    const { hub, transport, reconciliation } = await setup();
    await hub.append(STREAM, roundUpdated({ eventId: "a" }));
    transport.send.mockResolvedValue({
      ok: true,
      results: [
        {
          revision: 3,
          applied: true,
          appliedFields: null,
          rejectedFields: [],
          reason: null,
        },
      ],
    });

    // When
    const report = await reconciliation.send(STREAM, ["a"]);

    // Then
    expect(report).toEqual({ ok: true, diverged: false });
  });

  it("失敗は、種類をrpcか例外の文字列にし、rpcには状態とSQLSTATEを添える", async () => {
    // Given
    const { hub, transport, reconciliation } = await setup();
    await hub.append(STREAM, roundUpdated({ eventId: "a" }));
    transport.send.mockResolvedValueOnce({
      ok: false,
      cause: { type: "rpc", status: 403, code: "PT403" },
    });
    transport.send.mockRejectedValueOnce(new Error("boom"));

    // When
    const rpc = await reconciliation.send(STREAM, ["a"]);
    const exception = await reconciliation.send(STREAM, ["a"]);

    // Then
    expect(rpc).toEqual({
      ok: false,
      cause: "rpc",
      status: 403,
      code: "PT403",
    });
    expect(exception).toEqual({ ok: false, cause: "exception" });
  });
});

describe("refreshNeeds", () => {
  it("一覧の依頼の有無と、取り直しが要るラウンドを理由とともに返す", async () => {
    // Given
    const { hub, requests, reconciliation } = await setup();
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
    const needs = reconciliation.refreshNeeds();

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
    const { requests, reconciliation } = await setup();
    void requests.open("r-1");
    void requests.open("r-1");
    requests.watch("r-2", true);
    requests.requestAll();

    // When
    const needs = reconciliation.refreshNeeds();

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
    const { hub, requests, reconciliation } = await setup();
    const stream = roundStreamId("r-1");
    void requests.open("r-1");
    requests.watch("r-1", true);
    await hub.append(stream, roundUpdated({ eventId: "d" }));
    hub.applySendResults(stream, ["d"], [unfitResult]);
    requests.setOverlay("r-1", true);
    const reasons = () => reconciliation.refreshNeeds().rounds;

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
    const { hub, requests, reconciliation } = await setup();
    const stream = roundStreamId("r-1");
    requests.watch("r-1", true);
    await hub.append(stream, roundUpdated({ eventId: "d" }));
    hub.applySendResults(stream, ["d"], [unfitResult]);

    // When
    const needs = reconciliation.refreshNeeds();

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
      const before = tab.reconciliation.refreshNeeds().rounds;
      const refreshing = tab.reconciliation.refreshRound("r-1");
      await flush();
      return { ...tab, detailFetch, refreshing, before };
    }

    it("取り直しを始めると、取得が終わる前に効かなかった印が消える", async () => {
      // Given
      const { reconciliation, before } = await withDivergedMark();

      // When
      const during = reconciliation.refreshNeeds().rounds;

      // Then
      expect(before).toEqual([
        { roundId: "r-1", reason: "diverged", reasons: ["diverged"] },
      ]);
      expect(during).toEqual([]);
    });

    it("取得が失敗しても、効かなかった印は戻らない", async () => {
      // Given
      const { reconciliation, detailFetch, refreshing } =
        await withDivergedMark();

      // When
      detailFetch.resolve({ status: "error", message: "x" });
      const result = await refreshing;

      // Then
      expect(result).toBe("failed");
      expect(reconciliation.refreshNeeds().rounds).toEqual([]);
    });
  });

  it("端末のベースで開いた詳細が取り直しで成功すると、古い理由から外れる", async () => {
    // Given
    const { requests, reconciliation } = await setup();
    requests.watch("stale", true);

    // When
    settleRoundNow(requests, "stale", {
      status: "ok",
      data: { deleted: false, base: roundBase().tables, targetFaces: [] },
    });

    // Then
    expect(reconciliation.refreshNeeds().rounds).toEqual([]);
  });

  it("依頼や記録が変わったら通知し、解除すると両方の通知が止まる", async () => {
    // Given
    const { hub, requests, reconciliation } = await setup();
    const listener = vi.fn();
    const stop = reconciliation.onRefreshNeeds(listener);

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
    const { fetching, reconciliation } = await setup();
    fetching.fetchRoundDetails.mockResolvedValue({
      status: "ok",
      data: { rounds: new Map(), startedAt: 1, userId: "user-1" },
    });
    fetching.fetchRoundDetail.mockResolvedValue({ status: "not-found" });

    // When
    const committed = await reconciliation.refreshAll({ waitForList: false });
    const round = await reconciliation.refreshRound("round-1");

    // Then
    expect(committed).toBe(true);
    expect(round).toBe("gone");
  });
  it("開始した後に出した開く依頼は、その実行の結果を受けずに待ちとして残り、openを返し続ける。開始前の依頼は結果を受ける", async () => {
    // Given
    const { requests, fetching, reconciliation } = await setup();
    const before = requests.open("r-1");
    const detailFetch =
      Promise.withResolvers<FetchResult<FetchedRoundDetail>>();
    fetching.fetchRoundDetail.mockReturnValueOnce(detailFetch.promise);
    const refreshing = reconciliation.refreshRound("r-1");
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
    expect(reconciliation.refreshNeeds().rounds).toEqual([
      { roundId: "r-1", reason: "open", reasons: ["open"], openRequest: 2 },
    ]);
  });
});
