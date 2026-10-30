// biome-ignore-all lint/style/useNamingConvention: 生成した型(types/supabase.ts)のスキーマの形(Functions、Tables、Args、Returns、Row)と同じ名前で宣言するため。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database, Json } from "@/types/supabase";
import type { DbOrder } from "../contract/database";
import { createSupabaseDatabase, narrowDatabase } from "./database";

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

  it("並びの向きを渡すと、パッケージのorderにascendingが渡る", async () => {
    // Given
    const { client, calls } = fakeClient(ok);
    const database = createSupabaseDatabase(() => client);

    // When
    await database.select({
      table: "rounds",
      columns: "id",
      orders: [
        { column: "round_date", ascending: false },
        { column: "id", ascending: true },
      ],
    });

    // Then
    const orders = calls.filter(([method]) => method === "order");
    expect(orders).toEqual([
      ["order", ["round_date", { ascending: false }]],
      ["order", ["id", { ascending: true }]],
    ]);
  });

  it("参照する表の並びでは、referencedTableとascendingが一緒に渡る", async () => {
    // Given
    const { client, calls } = fakeClient(ok);
    const database = createSupabaseDatabase(() => client);

    // When
    await database.select({
      table: "rounds",
      columns: "id",
      orders: [
        {
          column: "position_key",
          referencedTable: "distances",
          ascending: false,
        },
      ],
    });

    // Then
    expect(calls).toContainEqual([
      "order",
      ["position_key", { referencedTable: "distances", ascending: false }],
    ]);
  });

  it("向きを省略すると、ascendingを渡さない呼び方のままである", async () => {
    // Given
    const { client, calls } = fakeClient(ok);
    const database = createSupabaseDatabase(() => client);

    // When
    await database.select({
      table: "rounds",
      columns: "id",
      orders: [
        { column: "id" },
        { column: "position_key", referencedTable: "distances" },
      ],
    });

    // Then
    const orders = calls.filter(([method]) => method === "order");
    expect(orders).toEqual([
      ["order", ["id"]],
      ["order", ["position_key", { referencedTable: "distances" }]],
    ]);
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
    const response = await database.rpc("record_shots", { p_shots: [] });

    // Then
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_shots", {
      p_shots: [],
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
    const response = await ok.rpc("is_round_member", {
      target_round_id: "r-1",
    });

    // Then
    expect(response).toEqual({ data: 1, error: null, status: 200 });
    await expect(
      throwing.rpc("is_round_member", { target_round_id: "r-1" }),
    ).rejects.toThrow("boom");
  });
});

// narrowDatabaseは、使う側が宣言した部分のスキーマを、生成した型と照合する。照合は型だけで、実行時は受け取ったものを返す。
// 型の誤りがなくなると、@ts-expect-errorが誤りになり、型の検査(pnpm typecheck)が落ちる。
type MatchingSchema = {
  Functions: {
    clear_shots: { Args: { p_shots: Json }; Returns: Json };
    is_round_member: { Args: { target_round_id: string }; Returns: boolean };
  };
  Tables: { rounds: { Row: { id: string; status: string } } };
};

describe("narrowDatabase", () => {
  it("受け取ったものを、そのまま(同じ参照で)返す", () => {
    // Given
    const { client } = fakeClient(ok);
    const gateway = createSupabaseDatabase(() => client);

    // When
    const narrowed = narrowDatabase<MatchingSchema>(gateway);

    // Then
    expect(narrowed).toBe(gateway);
  });

  it("生成した型と一致する部分のスキーマだけを通し、一致しないものは型の誤りにする", () => {
    // Given
    const { client } = fakeClient(ok);
    const gateway = createSupabaseDatabase(() => client);

    // When
    const check = () => {
      // 一致する場合は、型の誤りにならない。
      narrowDatabase<MatchingSchema>(gateway);
      // 関数の名前の誤記。
      // @ts-expect-error clear_shot は生成した型に無い。
      narrowDatabase<{
        Functions: { clear_shot: { Args: { p_shots: Json }; Returns: Json } };
        Tables: Record<never, never>;
      }>(gateway);
      // 必須の引数の欠落。
      // @ts-expect-error 必須の p_shots が無い。
      narrowDatabase<{
        Functions: {
          clear_shots: { Args: Record<never, never>; Returns: Json };
        };
        Tables: Record<never, never>;
      }>(gateway);
      // 引数の一部の欠落(複数の必須の引数のうち一部だけを宣言する)。生成した型の公開の関数に、省略可能な引数を持つものは無く、省略可能な引数の欠落は、この型では確かめられない。
      // @ts-expect-error shot_fits の必須の引数のうち、p_end_number 以外が無く、p_end_number は生成した型に無い。
      narrowDatabase<{
        Functions: {
          shot_fits: { Args: { p_end_number: number }; Returns: boolean };
        };
        Tables: Record<never, never>;
      }>(gateway);
      // 引数の型の違い。
      // @ts-expect-error p_shots は Json で、number ではない。
      narrowDatabase<{
        Functions: {
          clear_shots: { Args: { p_shots: number }; Returns: Json };
        };
        Tables: Record<never, never>;
      }>(gateway);
      // 余分な必須の引数。
      // @ts-expect-error p_typo は生成した型に無い。
      narrowDatabase<{
        Functions: {
          clear_shots: {
            Args: { p_shots: Json; p_typo: string };
            Returns: Json;
          };
        };
        Tables: Record<never, never>;
      }>(gateway);
      // 余分な省略可能な引数。
      // @ts-expect-error p_typo は生成した型に無い(省略可能でも)。
      narrowDatabase<{
        Functions: {
          clear_shots: {
            Args: { p_shots: Json; p_typo?: string };
            Returns: Json;
          };
        };
        Tables: Record<never, never>;
      }>(gateway);
      // 必須と省略可能の取り違え。
      // @ts-expect-error p_shots は必須で、省略可能ではない。
      narrowDatabase<{
        Functions: { clear_shots: { Args: { p_shots?: Json }; Returns: Json } };
        Tables: Record<never, never>;
      }>(gateway);
      // 列の名前の誤り。
      // @ts-expect-error statuss は rounds の列に無い。
      narrowDatabase<{
        Functions: Record<never, never>;
        Tables: { rounds: { Row: { statuss: string } } };
      }>(gateway);
      // 並びで宣言していない列を指定する。
      const order: DbOrder<MatchingSchema, "rounds"> = { column: "status" };
      // @ts-expect-error name は rounds の宣言した列に無い。
      const undeclared: DbOrder<MatchingSchema, "rounds"> = { column: "name" };
      void [order, undeclared];
      // 列の型の違い。
      // @ts-expect-error status は string で、number ではない。
      narrowDatabase<{
        Functions: Record<never, never>;
        Tables: { rounds: { Row: { status: number } } };
      }>(gateway);
      // 戻り値の違い。
      // @ts-expect-error is_round_member の戻り値は boolean で、string ではない。
      narrowDatabase<{
        Functions: {
          is_round_member: {
            Args: { target_round_id: string };
            Returns: string;
          };
        };
        Tables: Record<never, never>;
      }>(gateway);
    };

    // Then
    expect(check).toBeTypeOf("function");
  });
});
