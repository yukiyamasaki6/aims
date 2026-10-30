// biome-ignore-all lint/style/useNamingConvention: 生成した型(types/supabase.ts)のスキーマの形(Functions、Tables、Args、Returns、Row)と同じ名前で宣言するため。
// データベースのスキーマの形。技術の型を含まない。関数ごとの引数と戻り値、表ごとの行。
export type DbSchema = {
  Functions: Record<string, { Args: object; Returns: unknown }>;
  Tables: Record<string, { Row: object }>;
};

// データベースへの問い合わせ、削除、手続きの呼び出し。応答は外部の型を含まない、平らな形で返す。
// 例外: 投げることがある(接続を得られない、呼び出しが投げた)。使う側は通信の失敗と同じに扱う。
export type DbResponse<T = unknown> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
  // HTTPの状態。通信の失敗は0。
  status: number;
};

type TableOf<S extends DbSchema> = keyof S["Tables"] & string;
type ColumnOf<
  S extends DbSchema,
  T extends TableOf<S>,
> = keyof S["Tables"][T]["Row"] & string;

type DbFilter<S extends DbSchema, T extends TableOf<S>> =
  | {
      op: "eq" | "neq" | "is";
      column: ColumnOf<S, T>;
      value: string | number | boolean | null;
    }
  | { op: "in"; column: ColumnOf<S, T>; values: readonly string[] }
  | { op: "or"; expression: string };

// ascendingの既定は昇順。
export type DbOrder<S extends DbSchema, T extends TableOf<S>> =
  | { column: ColumnOf<S, T>; ascending?: boolean }
  | {
      [R in TableOf<S>]: {
        column: ColumnOf<S, R>;
        referencedTable: R;
        ascending?: boolean;
      };
    }[TableOf<S>];

export type DbSelect<S extends DbSchema, T extends TableOf<S>> = {
  table: T;
  // 列の文字列と`or`の式は、文字列で、型では確かめない。
  columns: string;
  filters?: readonly DbFilter<S, T>[];
  orders?: readonly DbOrder<S, T>[];
  // 1行を返す問い合わせ。無ければdataがnull。
  single?: "maybe";
};

// 1行以上を絞る削除。絞りの無い削除は型で書けない。
type DbDelete<S extends DbSchema, T extends TableOf<S>> = {
  table: T;
  filters: readonly [DbFilter<S, T>, ...DbFilter<S, T>[]];
};

export type DatabaseGateway<S extends DbSchema> = {
  // 問い合わせは、取得の側が再試行を持つため、パッケージの再試行を使わない。
  select<T extends TableOf<S>>(query: DbSelect<S, T>): Promise<DbResponse>;
  delete<T extends TableOf<S>>(command: DbDelete<S, T>): Promise<DbResponse>;
  rpc<N extends keyof S["Functions"] & string>(
    name: N,
    args: S["Functions"][N]["Args"],
  ): Promise<DbResponse<S["Functions"][N]["Returns"]>>;
};
