import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../domain/fetch-status";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import type { RoundListItem } from "../domain/round-list";
import { roundStreamId } from "../domain/sync-events";
import { createTestRounds } from "./round-record-test-helpers";

// 一覧の取得(ラウンドの取得の手続きの差し込み口)を差し替えて、一覧を読み込む。
function loadListWith(
  tab: ReturnType<typeof createTestRounds>,
  fetchList: () => Promise<FetchResult<RoundListItem[]>>,
) {
  tab.fetching.fetchRoundsList.mockImplementation(fetchList);
  return tab.list.loadList();
}

describe("loadList", () => {
  const items: RoundListItem[] = [
    { id: "round-1", name: "午前", roundDate: "2026-09-15", total: 0 },
  ];
  const ok = async () => ({ status: "ok", data: items }) as const;

  it("一覧の取得が成功したら、サーバーの一覧と、端末の列で削除済みのラウンドのIDを返す", async () => {
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
      data: { items, deleted: new Set(["deleted"]) },
    });
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

  it("一覧の取得が失敗したら、一覧の結果を返す", async () => {
    // Given
    const tab = createTestRounds();
    const failure = { status: "error", reason: "failed" } as const;

    // When
    const result = await loadListWith(tab, async () => failure);

    // Then
    expect(result).toEqual(failure);
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

describe("打ち切り", () => {
  it("端末の記録の読み込みが終わらない間に打ち切られても、切断ならofflineにする(一覧)", async () => {
    // Given
    const tab = createTestRounds();
    vi.spyOn(tab.hub, "readList").mockReturnValue(new Promise(() => {}));
    const list = loadListWith(tab, async () => ({ status: "ok", data: [] }));
    tab.connectivity.goOffline();

    // When
    await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);

    // Then
    expect(await list).toEqual({ status: "offline" });
  });
});
