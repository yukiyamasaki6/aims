import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type {
  DatabaseGateway,
  DbFilter,
  DbResponse,
  DbSelect,
} from "../contract/database";

// 問い合わせの組み立てで使う、ビルダーの形。生成した型は表の名前と列の名前を固定するが、ここは呼び出し側が文字列で指定する。
type QueryBuilder = {
  eq(column: string, value: unknown): QueryBuilder;
  neq(column: string, value: unknown): QueryBuilder;
  is(column: string, value: unknown): QueryBuilder;
  in(column: string, values: readonly string[]): QueryBuilder;
  or(expression: string): QueryBuilder;
  order(column: string, options?: { referencedTable: string }): QueryBuilder;
  maybeSingle(): QueryBuilder;
  retry(enabled: boolean): PromiseLike<DbResponse>;
};

type UntypedClient = {
  from(table: string): { select(columns: string): QueryBuilder };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResponse>;
};

function applyFilter(builder: QueryBuilder, filter: DbFilter): QueryBuilder {
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
): DatabaseGateway {
  const client = () => getClient() as unknown as UntypedClient;
  return {
    async select(query: DbSelect) {
      let builder = client().from(query.table).select(query.columns);
      for (const filter of query.filters ?? []) {
        builder = applyFilter(builder, filter);
      }
      for (const { column, referencedTable } of query.orders ?? []) {
        builder = referencedTable
          ? builder.order(column, { referencedTable })
          : builder.order(column);
      }
      if (query.single === "maybe") builder = builder.maybeSingle();
      return toResponse(await builder.retry(false));
    },
    async rpc(name, args) {
      return toResponse(await client().rpc(name, args));
    },
  };
}
