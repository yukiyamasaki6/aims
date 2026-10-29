import { describe, expect, it, vi } from "vitest";
import { roundStreamId } from "../domain/sync-events";
import {
  distanceCreated,
  roundBase,
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "../round-op-test-helpers";
import type { RoundFetching } from "./fetch-round-detail";
import { createRefreshRequests } from "./refresh-requests";
import { createRefreshRoundBases } from "./refresh-round-bases";
import { createRoundReconciliation } from "./round-reconciliation";
import {
  createTestRoundHub,
  settleRoundNow,
} from "./round-record-test-helpers";
import { createSendOperations, type RoundTransport } from "./send-operations";

const STREAM = roundStreamId("round-1");

// 結線(同期へ公開する平らな値への写し)が検証対象。取得と送信の中身は別のテストで確かめるため、約束を差し替える。
async function setup() {
  const { hub } = createTestRoundHub();
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
    send: createSendOperations({ hub, transport }),
    refresh: createRefreshRoundBases({
      hub,
      requests,
      fetching: fetching as unknown as RoundFetching,
    }),
  });
  return { hub, requests, transport, fetching, reconciliation };
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

  it("利用者の照合、現在の利用者、列の一覧、送る単位の上限を公開する", async () => {
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
    expect(reconciliation.userId()).toBe("user-1");
    expect(reconciliation.streams()).toEqual([STREAM]);
    expect(reconciliation.batchLimitOf("lane")).toBeGreaterThanOrEqual(1);
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
    stop();

    // Then
    expect(keptWhileSending).toBe(1);
    expect(reconciliation.userId()).toBe("user-2");
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

    // Then
    expect(afterStop).toEqual([]);
    expect(reconciliation.userId()).toBe("user-1");
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
        { roundId: "opening", reason: "open" },
        { roundId: "stale", reason: "stale" },
        { roundId: "overlay", reason: "overlay" },
        { roundId: "diverged", reason: "diverged" },
      ]),
    );
    expect(needs.rounds.map((need) => need.roundId)).not.toContain("quiet");
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
});
