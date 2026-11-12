import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseDatabase } from "@/lib/supabase/infrastructure/database";
import type { Database } from "@/types/supabase";
import { DEFAULT_HISTORY_CONDITION } from "../domain/history-view-state";
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
  it("ラウンドの詳細は、表・列・絞り・並び・1行の指定の順にSDKへ届き、最後に再試行ありを指定する", async () => {
    // Given
    const { database, calls } = fakeSdk({
      data: null,
      error: null,
      status: 200,
    });

    // When
    await createRoundQueries(database).roundDetail("round-1");

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
    expect(calls.filter(([method]) => method === "retry")).toEqual([
      ["retry", [true]],
    ]);
  });

  it("履歴の取得は、RPCの名前と引数のキー(基準・向き・種別・弓種・起点・件数)でSDKへ届き、応答はokの種類とページになって返る", async () => {
    // Given
    const { database, rpc } = fakeSdk({
      data: { rounds: [], has_more: false },
      error: null,
      status: 200,
    });

    // When
    const result = await createRoundQueries(database).roundsList({
      condition: DEFAULT_HISTORY_CONDITION,
      after: null,
      size: 10,
    });

    // Then
    expect(rpc).toHaveBeenCalledExactlyOnceWith("rounds_list", {
      p_sort_key: "date",
      p_sort_direction: "desc",
      p_format: null,
      p_bow_type: null,
      p_after_id: null,
      p_limit: 10,
    });
    expect(result).toEqual({
      status: "ok",
      data: { rounds: [], hasMore: false },
    });
  });
});
