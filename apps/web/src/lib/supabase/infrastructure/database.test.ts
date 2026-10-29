import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/supabase";
import { createSupabaseDatabase } from "./database";

type Call = [method: string, args: unknown[]];

// 接続は外部SDKの境界のため、呼ばれたメソッドを順に記録し、最後のretryで応答を返す偽のビルダーで模す。
function fakeClient(response: unknown) {
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
  return { client, calls, rpc };
}

const ok = { data: [{ id: "a" }], error: null, status: 200 };

describe("select", () => {
  it("表・列・フィルタ・並びの順に問い合わせを組み立て、最後に再試行なしを指定する", async () => {
    // Given
    const { client, calls } = fakeClient(ok);
    const database = createSupabaseDatabase(() => client);

    // When
    const response = await database.select({
      table: "rounds",
      columns: "id, name",
      filters: [
        { op: "eq", column: "id", value: "r-1" },
        { op: "neq", column: "status", value: "in_progress" },
        { op: "is", column: "disabled_at", value: null },
        { op: "in", column: "id", values: ["a", "b"] },
        { op: "or", expression: "a.eq.1,b.eq.2" },
      ],
      orders: [
        { column: "position_key", referencedTable: "distances" },
        { column: "id" },
      ],
    });

    // Then
    expect(calls).toEqual([
      ["from", ["rounds"]],
      ["select", ["id, name"]],
      ["eq", ["id", "r-1"]],
      ["neq", ["status", "in_progress"]],
      ["is", ["disabled_at", null]],
      ["in", ["id", ["a", "b"]]],
      ["or", ["a.eq.1,b.eq.2"]],
      ["order", ["position_key", { referencedTable: "distances" }]],
      ["order", ["id"]],
      ["retry", [false]],
    ]);
    expect(response).toEqual(ok);
  });

  it("1行を返す指定では、並びの後に最大1行の指定を付けてから再試行なしを指定する", async () => {
    // Given
    const { client, calls } = fakeClient(ok);
    const database = createSupabaseDatabase(() => client);

    // When
    await database.select({ table: "rounds", columns: "*", single: "maybe" });

    // Then
    expect(calls.map(([method]) => method)).toEqual([
      "from",
      "select",
      "maybeSingle",
      "retry",
    ]);
  });

  it("応答を、データ・エラーの符号と文言・HTTPの状態だけの平らな形で返す", async () => {
    // Given
    const { client } = fakeClient({
      data: null,
      error: { code: "42501", message: "forbidden", details: "x", hint: "y" },
      status: 403,
    });
    const database = createSupabaseDatabase(() => client);

    // When
    const response = await database.select({ table: "rounds", columns: "*" });

    // Then
    expect(response).toEqual({
      data: null,
      error: { code: "42501", message: "forbidden" },
      status: 403,
    });
  });

  it("呼ぶたびに接続を得る。接続を得られないときは投げる", async () => {
    // Given
    const { client } = fakeClient(ok);
    const getClient = vi.fn(() => client);
    const database = createSupabaseDatabase(getClient);
    const failing = createSupabaseDatabase(() => {
      throw new Error("環境変数が無い");
    });

    // When
    await database.select({ table: "rounds", columns: "*" });
    await database.select({ table: "rounds", columns: "*" });

    // Then
    expect(getClient).toHaveBeenCalledTimes(2);
    await expect(
      failing.select({ table: "rounds", columns: "*" }),
    ).rejects.toThrow("環境変数が無い");
  });

  it("通信が失敗したとき、再試行せず1回の呼び出しでstatus 0になる", async () => {
    // Given
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const client = createClient<Database>(
      "https://example.supabase.co",
      "anon-key",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: fetchMock as unknown as typeof fetch },
      },
    );
    const database = createSupabaseDatabase(() => client);

    // When
    const response = await database.select({ table: "rounds", columns: "*" });

    // Then
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(0);
  });
});

describe("rpc", () => {
  it("再試行の指定なしで、名前と引数を渡し、応答を平らな形で返す", async () => {
    // Given
    const { client, rpc } = fakeClient({
      data: [1],
      error: { code: "PT403", message: "denied", details: "x" },
      status: 400,
    });
    const database = createSupabaseDatabase(() => client);

    // When
    const response = await database.rpc("record_shots", { p_round_id: "r-1" });

    // Then
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_shots", {
      p_round_id: "r-1",
    });
    expect(response).toEqual({
      data: [1],
      error: { code: "PT403", message: "denied" },
      status: 400,
    });
  });

  it("エラーが無い応答は、エラーをnullで返し、接続の呼び出しが投げたら投げ直す", async () => {
    // Given
    const { client } = fakeClient({ data: 1, error: null, status: 200 });
    const ok = createSupabaseDatabase(() => client);
    const throwing = createSupabaseDatabase(
      () =>
        ({
          rpc: () => {
            throw new Error("boom");
          },
        }) as unknown as SupabaseClient<Database>,
    );

    // When
    const response = await ok.rpc("x", {});

    // Then
    expect(response).toEqual({ data: 1, error: null, status: 200 });
    await expect(throwing.rpc("x", {})).rejects.toThrow("boom");
  });
});
