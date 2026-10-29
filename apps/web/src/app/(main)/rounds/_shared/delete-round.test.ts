import { describe, expect, it, vi } from "vitest";
import type { RoundsStore } from "@/features/rounds/application/rounds-store";
import { deleteRound } from "./delete-round";

// ラウンドの状態と変更の方法は、画面の境界のため、追記だけを記録する偽の約束で模す。
function storeWith(append: RoundsStore["append"]) {
  return { append } as unknown as RoundsStore;
}

describe("deleteRound", () => {
  it("そのラウンドへ、round.disabledを積む", async () => {
    // Given
    const append = vi.fn<RoundsStore["append"]>().mockResolvedValue(undefined);

    // When
    await deleteRound(storeWith(append), "round-1");

    // Then
    expect(append).toHaveBeenCalledExactlyOnceWith("round-1", {
      type: "round.disabled",
      eventId: expect.any(String),
      roundId: "round-1",
    });
  });

  it("削除のたびに新しいeventIdを使う", async () => {
    // Given
    const append = vi.fn<RoundsStore["append"]>().mockResolvedValue(undefined);
    const store = storeWith(append);

    // When
    await deleteRound(store, "round-1");
    await deleteRound(store, "round-1");

    // Then
    const [first, second] = append.mock.calls.map(([, op]) => op.eventId);
    expect(first).not.toBe(second);
  });

  it("保存の試みが終わるまで解決しない", async () => {
    // Given
    let finish: () => void = () => {};
    const append = vi.fn<RoundsStore["append"]>().mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );

    // When
    let resolved = false;
    const promise = deleteRound(storeWith(append), "round-1").then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resolvedBeforeSave = resolved;
    finish();
    await promise;

    // Then
    expect(resolvedBeforeSave).toBe(false);
    expect(resolved).toBe(true);
  });
});
