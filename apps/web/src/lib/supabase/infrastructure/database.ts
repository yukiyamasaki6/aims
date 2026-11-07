// biome-ignore-all lint/style/useNamingConvention: 生成した型(types/supabase.ts)のスキーマの形(Functions、Tables、Args、Returns、Row)と同じ名前で宣言するため。
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type {
  DatabaseGateway,
  DbResponse,
  DbSchema,
} from "../contract/database";

// 問い合わせの組み立てで使う、ビルダーの形。生成した型は表の名前と列の名前を固定するが、ここは呼び出し側が文字列で指定する。
type FilterBuilder<B> = {
  eq(column: string, value: unknown): B;
  neq(column: string, value: unknown): B;
  is(column: string, value: unknown): B;
  in(column: string, values: readonly string[]): B;
  or(expression: string): B;
};

interface QueryBuilder extends FilterBuilder<QueryBuilder> {
  order(
    column: string,
    options?: { referencedTable?: string; ascending?: boolean },
  ): QueryBuilder;
  maybeSingle(): QueryBuilder;
  retry(enabled: boolean): PromiseLike<DbResponse>;
}

interface DeleteBuilder
  extends FilterBuilder<DeleteBuilder>,
    PromiseLike<DbResponse> {}

type UntypedClient = {
  from(table: string): {
    select(columns: string): QueryBuilder;
    delete(): DeleteBuilder;
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResponse>;
};

// 実装の中では、表と列を文字列として扱う(型の検査は、約束の側が行う)。
type LooseFilter =
  | {
      op: "eq" | "neq" | "is";
      column: string;
      value: string | number | boolean | null;
    }
  | { op: "in"; column: string; values: readonly string[] }
  | { op: "or"; expression: string };

type LooseSelect = {
  table: string;
  columns: string;
  filters?: readonly LooseFilter[];
  orders?: readonly {
    column: string;
    referencedTable?: string;
    ascending?: boolean;
  }[];
  single?: "maybe";
};

function applyFilter<B extends FilterBuilder<B>>(
  builder: B,
  filter: LooseFilter,
): B {
  switch (filter.op) {
    case "eq":
      return builder.eq(filter.column, filter.value);
    case "neq":
      return builder.neq(filter.column, filter.value);
    case "is":
      return builder.is(filter.column, filter.value);
    case "in":
      return builder.in(filter.column, filter.values);
    case "or":
      return builder.or(filter.expression);
  }
}

type LooseOrder = NonNullable<LooseSelect["orders"]>[number];

// 値のある選択肢だけを渡す(無ければ列だけで呼ぶ)。
function applyOrder(builder: QueryBuilder, order: LooseOrder): QueryBuilder {
  const options = {
    ...(order.referencedTable
      ? { referencedTable: order.referencedTable }
      : {}),
    ...(order.ascending === undefined ? {} : { ascending: order.ascending }),
  };
  return Object.keys(options).length > 0
    ? builder.order(order.column, options)
    : builder.order(order.column);
}

function toResponse({ data, error, status }: DbResponse): DbResponse {
  return {
    data,
    error: error ? { code: error.code, message: error.message } : null,
    status,
  };
}

// 接続は、呼ぶたびに得る(環境変数の欠落は呼び出しの失敗になる)。
export function createSupabaseDatabase(
  getClient: () => SupabaseClient<Database>,
): DatabaseGateway<Database["public"]> {
  const client = () => getClient() as unknown as UntypedClient;
  return {
    async select(query: LooseSelect) {
      let builder = client().from(query.table).select(query.columns);
      for (const filter of query.filters ?? []) {
        builder = applyFilter(builder, filter);
      }
      for (const order of query.orders ?? []) {
        builder = applyOrder(builder, order);
      }
      if (query.single === "maybe") builder = builder.maybeSingle();
      return toResponse(await builder.retry(false));
    },
    async delete(command: { table: string; filters: readonly LooseFilter[] }) {
      let builder = client().from(command.table).delete();
      for (const filter of command.filters) {
        builder = applyFilter(builder, filter);
      }
      return toResponse(await builder);
    },
    // 戻り値の型は、生成した型の宣言どおりに返ることを前提にする(実行時の写しは変えない)。
    rpc: (async (name: string, args: object) =>
      toResponse(
        await client().rpc(name, args as Record<string, unknown>),
      )) as DatabaseGateway<Database["public"]>["rpc"],
  };
}

// 以降は、使う側が宣言した部分のスキーマと、生成した型との照合。

// AとBが互いに代入できるとき真。
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// 省略可能なキーの集合。
type OptionalKeys<T> = {
  // biome-ignore lint/complexity/noBannedTypes: 省略可能かの判定に、空の型との代入を使う。
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

// キーの集合、省略可能なキーの集合、全体の両向きの代入が一致するとき真。省略可能な余分なキーは、両向きの代入だけでは検出できないため、キーの集合を先に比べる。
type Exact<A, B> =
  Same<keyof A, keyof B> extends true
    ? Same<OptionalKeys<A>, OptionalKeys<B>> extends true
      ? Same<A, B>
      : false
    : false;

type Full = Database["public"];

// Sの関数(引数と戻り値)と表の列(名前と型)が、生成した型と一致するときだけSと同じ形になる。一致しない項目はneverになり、制約を満たさない。
type SubsetOf<S extends DbSchema> = {
  Functions: {
    [K in keyof S["Functions"]]: K extends keyof Full["Functions"]
      ? Exact<
          S["Functions"][K]["Args"],
          Full["Functions"][K]["Args"]
        > extends true
        ? Same<
            S["Functions"][K]["Returns"],
            Full["Functions"][K]["Returns"]
          > extends true
          ? S["Functions"][K]
          : never
        : never
      : never;
  };
  Tables: {
    [T in keyof S["Tables"]]: T extends keyof Full["Tables"]
      ? {
          Row: {
            [C in keyof S["Tables"][T]["Row"]]: C extends keyof Full["Tables"][T]["Row"]
              ? Same<
                  S["Tables"][T]["Row"][C],
                  Full["Tables"][T]["Row"][C]
                > extends true
                ? S["Tables"][T]["Row"][C]
                : never
              : never;
          };
        }
      : never;
  };
};

// 生成した型の実装を、使う側が宣言した部分のスキーマとして渡す。実行時は受け取ったものをそのまま返す。
export function narrowDatabase<S extends DbSchema & SubsetOf<S>>(
  gateway: DatabaseGateway<Full>,
): DatabaseGateway<S> {
  return gateway as unknown as DatabaseGateway<S>;
}
