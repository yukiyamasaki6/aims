import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryViewState,
} from "../domain/history-view-state";
import { createFakeHistoryViewMemory } from "./fake-history-view-memory-test-helpers";

describe("createFakeHistoryViewMemory", () => {
  it("書いた状態を、readとstoredが返す", () => {
    // Given
    const written: HistoryViewState = {
      condition: {
        sortKey: "score",
        sortDirection: "asc",
        format: "indoor",
        bowType: null,
        dateFrom: "2026-05-01",
        dateTo: null,
        scoreMin: 0,
        scoreMax: null,
      },
      filterOpen: false,
    };
    const { memory, stored } = createFakeHistoryViewMemory();

    // When
    memory.write(written);

    // Then
    expect(memory.read()).toEqual(written);
    expect(stored()).toEqual(written);
  });

  it("書いていなければ、初期の状態を返す", () => {
    // Given
    const { memory } = createFakeHistoryViewMemory();

    // When
    const state = memory.read();

    // Then
    expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
  });
});
