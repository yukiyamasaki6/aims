import { describe, expect, it, vi } from "vitest";
import type { RoundReconciliation } from "@/features/rounds";
import { createRoundsRecords } from "./rounds-records";

// 同期の言葉への写しが検証対象。突き合わせの操作は約束で差し替える。
function reconciliationWith(
  send: RoundReconciliation["send"],
): RoundReconciliation {
  return {
    send,
    streams: () => ["round:r1"],
    outbox: () => [{ eventId: "a", lane: "serial", saved: true, hasSeq: true }],
  } as unknown as RoundReconciliation;
}

describe("createRoundsRecords", () => {
  it("成功はそのまま返し、失敗のrpcは状態とSQLSTATEを持つ失敗の種類に、例外は例外の種類に写す", async () => {
    // Given
    const send = vi
      .fn<RoundReconciliation["send"]>()
      .mockResolvedValueOnce({ ok: true, diverged: true })
      .mockResolvedValueOnce({
        ok: false,
        cause: "rpc",
        status: 403,
        code: "PT403",
      })
      .mockResolvedValueOnce({ ok: false, cause: "exception" });
    const records = createRoundsRecords(reconciliationWith(send));

    // When
    const success = await records.send("round:r1", ["a"]);
    const rpc = await records.send("round:r1", ["a"]);
    const exception = await records.send("round:r1", ["a"]);

    // Then
    expect(success).toEqual({ ok: true, diverged: true });
    expect(rpc).toEqual({
      ok: false,
      cause: { type: "rpc", status: 403, code: "PT403" },
    });
    expect(exception).toEqual({ ok: false, cause: { type: "exception" } });
  });

  it("送信以外の操作は、突き合わせの操作をそのまま公開する(outboxの射影を含む)", () => {
    // Given
    const records = createRoundsRecords(reconciliationWith(vi.fn()));

    // When
    const streams = records.streams();
    const outbox = records.outbox("round:r1");

    // Then
    expect(streams).toEqual(["round:r1"]);
    expect(outbox).toEqual([
      { eventId: "a", lane: "serial", saved: true, hasSeq: true },
    ]);
  });
});
