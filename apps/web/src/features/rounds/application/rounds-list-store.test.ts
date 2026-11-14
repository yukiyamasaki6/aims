import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../domain/fetch-status";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import {
  DEFAULT_HISTORY_CONDITION,
  type HistoryCondition,
} from "../domain/history-view-state";
import type { RoundsPage } from "../domain/round-list";
import { roundCreated } from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import { createTestRounds } from "./round-record-test-helpers";

// 一覧の取得(ラウンドの取得の手続きの差し込み口)を差し替えて、先頭のページを読み込む。
function loadListWith(
  tab: ReturnType<typeof createTestRounds>,
  fetchList: () => Promise<FetchResult<RoundsPage>>,
) {
  tab.fetching.fetchRoundsList.mockImplementation(fetchList);
  return tab.list.loadList(DEFAULT_HISTORY_CONDITION, null, 10);
}

const page: RoundsPage = {
  items: [{ id: "round-1", name: "午前", roundDate: "2026-09-15", total: 0 }],
  hasMore: true,
  after: "round-1",
};

describe("loadList", () => {
  const ok = async () => ({ status: "ok", data: page }) as const;

  it("ページの取得が成功したら、ページ(項目、続きの有無、起点)と、端末の列で削除済みのラウンドのIDを返す", async () => {
    // Given
    const tab = createTestRounds();
    await tab.hub.ready();
    await tab.hub.append(roundStreamId("deleted"), {
      type: "round.disabled",
      eventId: "e-deleted",
      roundId: "deleted",
    });

    // When
    const result = await loadListWith(tab, ok);

    // Then
    expect(result).toEqual({
      status: "ok",
      data: { ...page, deleted: new Set(["deleted"]) },
    });
  });

  it("条件(期間と得点の範囲を含む)、続きの起点、件数を、ページの取得へそのまま渡す", async () => {
    // Given
    const tab = createTestRounds();
    tab.fetching.fetchRoundsList.mockImplementation(ok);
    const condition: HistoryCondition = {
      unit: "round",
      sortKey: "score",
      sortDirection: "asc",
      format: "indoor",
      bowType: "compound",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
      scoreMin: 0,
      scoreMax: 600,
      distances: [],
      distanceRow: null,
    };

    // When
    await tab.list.loadList(condition, "round-9", 25);

    // Then
    expect(tab.fetching.fetchRoundsList).toHaveBeenCalledWith(
      condition,
      "round-9",
      25,
    );
  });

  it("一覧を読み込んでも、一括の取得は起こさず、一括の取得を待たない(時計を進めずに解決する)", async () => {
    // Given
    const tab = createTestRounds();

    // When
    const result = await loadListWith(tab, ok);

    // Then
    expect(result).toMatchObject({ status: "ok" });
    expect(tab.fetching.fetchRoundDetails).not.toHaveBeenCalled();
  });

  it("ページの取得が失敗したら、その結果をそのまま返す", async () => {
    // Given
    const tab = createTestRounds();
    const failure = { status: "error", reason: "failed" } as const;

    // When
    const result = await loadListWith(tab, async () => failure);

    // Then
    expect(result).toEqual(failure);
  });

  it("ページの取得がofflineなら、その結果をそのまま返す", async () => {
    // Given
    const tab = createTestRounds();

    // When
    const result = await loadListWith(tab, async () => ({
      status: "offline",
    }));

    // Then
    expect(result).toEqual({ status: "offline" });
  });

  it("確定済み・未確定の削除とも、端末の記録へ反映せず、削除済みの一覧に含める", async () => {
    // Given
    const tab = createTestRounds();
    await tab.hub.ready();
    const confirmedStream = roundStreamId("confirmed");
    const unsentStream = roundStreamId("unsent");
    await tab.hub.append(confirmedStream, {
      type: "round.disabled",
      eventId: "e-confirmed",
      roundId: "confirmed",
    });
    tab.hub.applySendResults(
      confirmedStream,
      ["e-confirmed"],
      [
        {
          revision: 2,
          applied: true,
          appliedFields: null,
          hasRejectedFields: false,
        },
      ],
    );
    await tab.hub.append(unsentStream, {
      type: "round.disabled",
      eventId: "e-unsent",
      roundId: "unsent",
    });

    // When
    const result = await loadListWith(tab, ok);

    // Then
    expect(result.status === "ok" && [...result.data.deleted]).toEqual([
      "confirmed",
      "unsent",
    ]);
    expect(tab.hub.record(confirmedStream).base).toBeUndefined();
    expect(tab.hub.record(unsentStream).base).toBeUndefined();
  });
});

describe("readDeleted", () => {
  it("取得せずに、端末の列で削除済みのラウンドのIDだけを返す", async () => {
    // Given
    const tab = createTestRounds();
    await tab.hub.ready();
    await tab.hub.append(roundStreamId("deleted"), {
      type: "round.disabled",
      eventId: "e-deleted",
      roundId: "deleted",
    });
    await tab.hub.append(roundStreamId("alive"), roundCreated());

    // When
    const deleted = await tab.list.readDeleted();

    // Then
    expect([...deleted]).toEqual(["deleted"]);
    expect(tab.fetching.fetchRoundsList).not.toHaveBeenCalled();
  });
});

describe("打ち切り", () => {
  it("端末の記録の読み込みが終わらない間に打ち切られても、切断ならofflineにする(一覧)", async () => {
    // Given
    const tab = createTestRounds();
    vi.spyOn(tab.hub, "readList").mockReturnValue(new Promise(() => {}));
    const list = loadListWith(tab, async () => ({ status: "ok", data: page }));
    tab.connectivity.goOffline();

    // When
    await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);

    // Then
    expect(await list).toEqual({ status: "offline" });
  });
});
