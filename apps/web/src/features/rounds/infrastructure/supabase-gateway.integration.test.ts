import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseDatabase } from "@/lib/supabase/infrastructure/database";
import type { Database } from "@/types/supabase";
import { roundUpdated, shotRecorded } from "../domain/round-op-test-helpers";
import { createRoundOpTransport } from "./round-op-transport";
import { createRoundQueries } from "./round-queries";
import type { RoundsDbSchema } from "./rounds-db-schema";

// 外部SDKの呼び方が検証対象。実物のゲートウェイを通して、SDKへの呼び出しが変更前と同じ形になることを確かめる。
// SDKの接続は、呼ばれたメソッドを記録し、応答を返す偽で模す。
type Call = [method: string, args: unknown[]];

function fakeSdk(response: { data: unknown; error: unknown; status: number }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_, method) {
        return (...args: unknown[]) => {
          calls.push([String(method), args]);
          return method === "retry" ? Promise.resolve(response) : builder;
        };
      },
    },
  );
  const rpc = vi.fn(async () => response);
  const client = {
    from: (table: string) => {
      calls.push(["from", [table]]);
      return builder;
    },
    rpc,
  } as unknown as SupabaseClient<Database>;
  return {
    database: createSupabaseDatabase<RoundsDbSchema>(() => client),
    calls,
    rpc,
  };
}

describe("書き込みのRPC", () => {
  it("ラウンドの更新は、RPCの名前と引数のキーが変更前と同じ形でSDKへ届く", async () => {
    // Given
    const { database, rpc } = fakeSdk({
      data: {
        revision: 5,
        applied: true,
        applied_fields: null,
        rejected_fields: [],
        reason: null,
      },
      error: null,
      status: 200,
    });
    const transport = createRoundOpTransport(database);
    const operation = roundUpdated({ changes: { name: "新" } });

    // When
    const outcome = await transport.send([
      { eventId: operation.eventId, operation },
    ]);

    // Then
    expect(outcome.ok).toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("update_round", {
      p_round_event_id: "e-round-updated",
      p_round_id: "round-1",
      p_changes: { name: "新" },
    });
  });

  it("矢の記録は、再試行の指定なしで、束のRPCへ渡る", async () => {
    // Given
    const { database, rpc } = fakeSdk({
      data: [
        {
          revision: 1,
          applied: true,
          applied_fields: null,
          rejected_fields: [],
          reason: null,
        },
      ],
      error: null,
      status: 200,
    });
    const operation = shotRecorded();

    // When
    await createRoundOpTransport(database).send([
      { eventId: operation.eventId, operation },
    ]);

    // Then
    expect(rpc.mock.calls[0]).toEqual([
      "record_shots",
      { p_shots: [expect.objectContaining({ shot_id: "s-1" })] },
    ]);
  });
});

describe("取得の問い合わせ", () => {
  it("ラウンドの詳細は、表・列・絞り・並び・1行の指定の順にSDKへ届き、最後に再試行なしを指定する", async () => {
    // Given
    const { database, calls } = fakeSdk({
      data: null,
      error: null,
      status: 200,
    });

    // When
    await createRoundQueries(database).roundDetail("user-1", "round-1");

    // Then
    const rounds = calls.slice(0, 8).map(([method]) => method);
    expect(rounds).toEqual([
      "from",
      "select",
      "eq",
      "is",
      "order",
      "order",
      "maybeSingle",
      "retry",
    ]);
    expect(calls).toContainEqual(["eq", ["id", "round-1"]]);
    expect(calls).toContainEqual([
      "or",
      ["owner_id.is.null,owner_id.eq.user-1"],
    ]);
    expect(calls.filter(([method]) => method === "retry")).toEqual([
      ["retry", [false]],
      ["retry", [false]],
    ]);
  });

  it("SDKの応答は、okの種類とデータになって返る", async () => {
    // Given
    const { database } = fakeSdk({ data: [], error: null, status: 200 });

    // When
    const result = await createRoundQueries(database).roundsList();

    // Then
    expect(result).toEqual({ status: "ok", data: [] });
  });
});
