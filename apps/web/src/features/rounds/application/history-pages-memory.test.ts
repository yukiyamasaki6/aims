import { describe, expect, it } from "vitest";
import {
  createHistoryPagesMemory,
  type HistoryPagesSnapshot,
} from "./history-pages-memory";

const snapshot = (id: string): HistoryPagesSnapshot => ({
  list: {
    items: [{ id, name: id, roundDate: "2026-09-15", total: 500 }],
    hasMore: true,
    after: id,
    deleted: new Set(),
  },
  scrollTop: 120,
});

describe("createHistoryPagesMemory", () => {
  it("書いた内容を読める", () => {
    // Given
    const memory = createHistoryPagesMemory();

    // When
    memory.write(snapshot("a"));

    // Then
    expect(memory.read()).toEqual(snapshot("a"));
  });

  it("何も書いていないときは、読むとnullを返す", () => {
    // Given
    const memory = createHistoryPagesMemory();

    // When
    const read = memory.read();

    // Then
    expect(read).toBeNull();
  });

  it("消すと、読むとnullを返す", () => {
    // Given
    const memory = createHistoryPagesMemory();
    memory.write(snapshot("a"));

    // When
    memory.clear();

    // Then
    expect(memory.read()).toBeNull();
  });

  it("最後に書いた1つだけを持つ", () => {
    // Given
    const memory = createHistoryPagesMemory();
    memory.write(snapshot("a"));

    // When
    memory.write(snapshot("b"));

    // Then
    expect(memory.read()).toEqual(snapshot("b"));
  });

  it("別のインスタンスと内容を共有しない", () => {
    // Given
    const first = createHistoryPagesMemory();
    const second = createHistoryPagesMemory();

    // When
    first.write(snapshot("a"));

    // Then
    expect(second.read()).toBeNull();
  });
});
