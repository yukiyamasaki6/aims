// データベースへの問い合わせと手続きの呼び出し。応答は外部の型を含まない、平らな形で返す。
// 例外: 投げることがある(接続を得られない、呼び出しが投げた)。使う側は通信の失敗と同じに扱う。
export type DbResponse = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  // HTTPの状態。通信の失敗は0。
  status: number;
};

export type DbFilter =
  | {
      op: "eq" | "neq" | "is";
      column: string;
      value: string | number | boolean | null;
    }
  | { op: "in"; column: string; values: readonly string[] }
  | { op: "or"; expression: string };

export type DbSelect = {
  table: string;
  columns: string;
  filters?: readonly DbFilter[];
  orders?: readonly { column: string; referencedTable?: string }[];
  // 1行を返す問い合わせ。無ければdataがnull。
  single?: "maybe";
};

export type DatabaseGateway = {
  // 問い合わせは、取得の側が再試行を持つため、パッケージの再試行を使わない。
  select(query: DbSelect): Promise<DbResponse>;
  rpc(name: string, args: Record<string, unknown>): Promise<DbResponse>;
};
