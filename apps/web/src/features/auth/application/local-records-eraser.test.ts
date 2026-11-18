import { describe, expect, it, vi } from "vitest";
import { createLocalRecordsEraser } from "./local-records-eraser";

describe("createLocalRecordsEraser", () => {
  it("全ての消去を、指定した利用者のIDで実行する", async () => {
    // Given
    const first = vi.fn(async () => {});
    const second = vi.fn();
    const eraser = createLocalRecordsEraser([first, second]);

    // When
    await eraser.erase("user-1");

    // Then
    expect(first).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(second).toHaveBeenCalledExactlyOnceWith("user-1");
  });

  it("同期で投げる消去と、拒否される消去があっても、他の消去は実行され、失敗は投げない", async () => {
    // Given
    const throwing = vi.fn(() => {
      throw new Error("sync failure");
    });
    const rejecting = vi.fn(async () => {
      throw new Error("async failure");
    });
    const healthy = vi.fn();
    const eraser = createLocalRecordsEraser([throwing, rejecting, healthy]);

    // When
    const result = eraser.erase("user-1");

    // Then
    await expect(result).resolves.toBeUndefined();
    expect(healthy).toHaveBeenCalledExactlyOnceWith("user-1");
  });
});
