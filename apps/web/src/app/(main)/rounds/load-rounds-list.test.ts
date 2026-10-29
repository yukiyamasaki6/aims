import { describe, expect, it, vi } from "vitest";
import type {
  LoadedRoundsList,
  RoundsStore,
} from "@/features/rounds/application/rounds-store";
import type { FetchResult } from "@/features/rounds/domain/fetch-result";
import type { RoundListItem } from "./fetch-rounds-list";
import { loadRoundsList } from "./load-rounds-list";

// 一覧の材料の求め方は、ラウンドの状態のテストで確かめる。ここは、画面の一覧の取得を渡して委譲する薄さを確かめる。
describe("loadRoundsList", () => {
  it("この画面の一覧の取得を渡して、ラウンドの状態の一覧の読み込みに委譲し、その結果を返す", async () => {
    // Given
    const loaded: FetchResult<LoadedRoundsList> = {
      status: "ok",
      data: { items: [], inProgress: [], deleted: new Set() },
    };
    const loadList = vi.fn<RoundsStore["loadList"]>().mockResolvedValue(loaded);
    const fetchServerList = vi.fn(
      async (): Promise<FetchResult<RoundListItem[]>> => ({
        status: "ok",
        data: [],
      }),
    );

    // When
    const result = await loadRoundsList(
      { loadList } as unknown as RoundsStore,
      fetchServerList,
    );

    // Then
    expect(result).toBe(loaded);
    expect(loadList).toHaveBeenCalledExactlyOnceWith(fetchServerList);
    expect(fetchServerList).not.toHaveBeenCalled();
  });
});
