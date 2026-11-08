import { describe, expect, it, vi } from "vitest";
import { roundUpdated } from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import {
  createOperationSending,
  type OpResult,
  type RoundTransport,
  type SendOutcome,
} from "./operation-sending";
import { createTestRoundHub } from "./round-record-test-helpers";

const STREAM = roundStreamId("round-1");
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const result = (overrides: Partial<OpResult> = {}): OpResult => ({
  revision: 5,
  applied: true,
  appliedFields: null,
  hasRejectedFields: false,
  ...overrides,
});

async function setup(outcome: SendOutcome | (() => Promise<SendOutcome>)) {
  const { hub, store } = createTestRoundHub();
  hub.start("user-1");
  await hub.ready();
  const send = vi.fn(async () =>
    typeof outcome === "function" ? outcome() : outcome,
  );
  const transport: RoundTransport = { send };
  const sending = createOperationSending({ hub, transport });
  return { hub, store, sending, send };
}

const operation = (id: string) =>
  roundUpdated({ eventId: id, changes: { name: id } });

describe("send", () => {
  it("記録にある操作を、要求の順で転送し、成功したら確定を記録へ書く", async () => {
    // Given
    const tab = await setup({ ok: true, results: [result({ revision: 7 })] });
    await tab.hub.append(STREAM, operation("a"));

    // When
    const report = await tab.sending.send(STREAM, ["a"]);
    await flush();

    // Then
    expect(report).toEqual({ ok: true });
    expect(tab.send).toHaveBeenCalledExactlyOnceWith([
      { eventId: "a", operation: operation("a") },
    ]);
    expect(tab.hub.record(STREAM).items[0]).toMatchObject({
      ackedRevision: 7,
      ackedApplied: true,
    });
    expect(tab.store.rows[0].ackedRevision).toBe(7);
  });

  it("効かなかった操作は記録と保存先から外す", async () => {
    // Given
    const tab = await setup({
      ok: true,
      results: [result({ revision: null, applied: false })],
    });
    await tab.hub.append(STREAM, operation("a"));

    // When
    const report = await tab.sending.send(STREAM, ["a"]);
    await flush();

    // Then
    expect(report).toEqual({ ok: true });
    expect(tab.hub.record(STREAM).items).toEqual([]);
    expect(tab.store.rows).toEqual([]);
  });

  it("送信に失敗したら、失敗の種類を返し、記録を変えない", async () => {
    // Given
    const tab = await setup({
      ok: false,
      failure: { cause: "rpc", code: "XX000" },
    });
    await tab.hub.append(STREAM, operation("a"));

    // When
    const report = await tab.sending.send(STREAM, ["a"]);

    // Then
    expect(report).toEqual({
      ok: false,
      failure: { cause: "rpc", code: "XX000" },
    });
    expect(tab.hub.record(STREAM).items[0].ackedRevision).toBeUndefined();
  });

  it("転送が投げたら、そのまま投げ、記録を変えない", async () => {
    // Given
    const tab = await setup(async () => {
      throw new Error("接続できない");
    });
    await tab.hub.append(STREAM, operation("a"));

    // When
    const sending = tab.sending.send(STREAM, ["a"]);

    // Then
    await expect(sending).rejects.toThrow("接続できない");
    expect(tab.hub.record(STREAM).items[0].ackedRevision).toBeUndefined();
  });

  it("送信の間に停止・起動されたら、現在の記録に触れず、保存先の確定だけを書く", async () => {
    // Given
    const pending = Promise.withResolvers<SendOutcome>();
    const tab = await setup(() => pending.promise);
    await tab.hub.append(STREAM, operation("a"));
    const sending = tab.sending.send(STREAM, ["a"]);
    await flush();
    tab.hub.stop();
    tab.hub.start("user-2");
    await tab.hub.ready();

    // When
    pending.resolve({ ok: true, results: [result({ revision: 9 })] });
    const report = await sending;
    await flush();

    // Then
    expect(report).toEqual({ ok: true });
    expect(tab.hub.record(STREAM).items).toEqual([]);
    expect(tab.store.rows[0]).toMatchObject({ eventId: "a", ackedRevision: 9 });
  });

  it("記録に無い操作は転送せず、成功として返す", async () => {
    // Given
    const tab = await setup({ ok: true, results: [] });

    // When
    const report = await tab.sending.send(STREAM, ["missing"]);

    // Then
    expect(report).toEqual({ ok: true });
    expect(tab.send).not.toHaveBeenCalled();
  });
});
