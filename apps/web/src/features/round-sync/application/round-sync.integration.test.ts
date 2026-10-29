import { describe, expect, it, vi } from "vitest";
import type {
  FetchedRoundDetail,
  RoundFetching,
} from "@/features/rounds/application/fetch-round-detail";
import { createRefreshRequests } from "@/features/rounds/application/refresh-requests";
import { createRefreshRoundBases } from "@/features/rounds/application/refresh-round-bases";
import { createRoundReconciliation } from "@/features/rounds/application/round-reconciliation";
import { createTestRoundHub } from "@/features/rounds/application/round-record-test-helpers";
import { createRoundsStore } from "@/features/rounds/application/rounds-store";
import { createSendOperations } from "@/features/rounds/application/send-operations";
import type { FetchResult } from "@/features/rounds/domain/fetch-result";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createRoundsRecords } from "../infrastructure/rounds-records";
import { createOpSender } from "./op-sender";
import { createSenderLockBus, flush } from "./op-sender-test-helpers";
import { createRoundSync } from "./round-sync";

// 実物の依頼の記録、取得と反映、画面の状態、同期の手続きを接続する。取得(サーバー)、送信、時計だけを差し替える。
function detail(name: string): FetchedRoundDetail {
  return {
    roundConfig: {
      name,
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

function rig() {
  const { hub } = createTestRoundHub();
  const requests = createRefreshRequests();
  const clock = createManualClock();
  const connectivity = createFakeConnectivity();
  const fetching = {
    fetchRoundDetail:
      vi.fn<(roundId: string) => Promise<FetchResult<FetchedRoundDetail>>>(),
    fetchRoundDetails: vi.fn(),
    fetchTargetFaces: vi.fn(),
    savedTargetFaces: () => null,
  };
  const reconciliation = createRoundReconciliation({
    hub,
    requests,
    send: createSendOperations({
      hub,
      transport: { send: vi.fn(() => new Promise<never>(() => {})) },
    }),
    refresh: createRefreshRoundBases({
      hub,
      requests,
      fetching: fetching as unknown as RoundFetching,
    }),
  });
  const records = createRoundsRecords(reconciliation);
  const session = {
    read: async () => ({ status: "authenticated", userId: "user-1" }) as const,
  };
  const sync = createRoundSync({
    records,
    sender: createOpSender({
      records,
      session,
      lock: createSenderLockBus({ solo: true }).lock(),
      clock,
      connectivity,
    }),
    session,
    clock,
    connectivity,
  });
  const store = createRoundsStore({
    hub,
    requests,
    fetching: fetching as unknown as RoundFetching,
    clock,
    connectivity,
  });
  sync.start("user-1");
  return { sync, store, requests, fetching, clock };
}

const deferredDetail = () =>
  Promise.withResolvers<FetchResult<FetchedRoundDetail>>();

describe("詳細を開く依頼と同期", () => {
  it("詳細の取得中に追加された2つ目の開く依頼も処理され、タイムアウトしない", async () => {
    // Given
    const t = rig();
    const first = deferredDetail();
    const second = deferredDetail();
    t.fetching.fetchRoundDetail
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const loadFirst = t.store.load("r1");
    await flush();
    const loadSecond = t.store.load("r1");
    await flush();

    // When
    first.resolve({ status: "ok", data: detail("1回目") });
    await flush();
    second.resolve({ status: "ok", data: detail("2回目") });
    await flush();

    // Then
    expect(await loadFirst).toMatchObject({ status: "ok" });
    expect(await loadSecond).toMatchObject({
      status: "ok",
      data: { source: "server" },
    });
    expect(t.fetching.fetchRoundDetail).toHaveBeenCalledTimes(2);
  });

  it("停止前の詳細の取得は、再開後の成功の結果を上書きしない", async () => {
    // Given
    const t = rig();
    const before = deferredDetail();
    const after = deferredDetail();
    t.fetching.fetchRoundDetail
      .mockReturnValueOnce(before.promise)
      .mockReturnValueOnce(after.promise);
    const loadBefore = t.store.load("r1");
    await flush();
    t.sync.stop();
    t.sync.start("user-1");
    const loadAfter = t.store.load("r1");
    await flush();

    // When
    after.resolve({ status: "ok", data: detail("再開後") });
    await flush();
    const outcomeAfterResume = t.requests.outcomeOf("r1");
    before.resolve({ status: "not-found" });
    await flush();

    // Then
    expect(await loadBefore).toMatchObject({ status: "error" });
    expect(await loadAfter).toMatchObject({ status: "ok" });
    expect(outcomeAfterResume).toBe("ok");
    expect(t.requests.outcomeOf("r1")).toBe("ok");
  });

  it("停止すると、待っている開く依頼と一覧の依頼がエラーで終わる", async () => {
    // Given
    const t = rig();
    t.fetching.fetchRoundDetail.mockReturnValue(new Promise(() => {}));
    const detailLoading = t.store.load("r1");
    const listLoading = t.store.loadList(async () => ({
      status: "ok",
      data: [],
    }));
    await flush();

    // When
    t.sync.stop();

    // Then
    expect(await detailLoading).toMatchObject({ status: "error" });
    expect(await listLoading).toMatchObject({ status: "error" });
  });
});
