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
// スキーマ`S`は、使う側が生成した型(`Database["public"]`)の部分集合として宣言する。実行時の写しは変えない。
export function createSupabaseDatabase<S extends DbSchema = Database["public"]>(
  getClient: () => SupabaseClient<Database>,
): DatabaseGateway<S> {
  const client = () => getClient() as unknown as UntypedClient;
  const gateway = {
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
    rpc: async (name: string, args: object) =>
      toResponse(await client().rpc(name, args as Record<string, unknown>)),
  };
  return gateway as unknown as DatabaseGateway<S>;
}
