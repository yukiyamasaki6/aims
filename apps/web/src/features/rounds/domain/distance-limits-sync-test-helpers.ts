// DBのマイグレーション(SQLの文字列)から、距離(m)・総エンド数・矢数の上限を読み取る。
// 実DBの値ではなく、SQLに書かれた値を読む。書式を読めないときは、黙って通さず例外にする。

export type LimitItem = "distance" | "totalEnds" | "arrowsPerEnd";

export type MigrationLimits = {
  // 制約名ごとの上限。
  constraints: Record<string, number>;
  // 判定関数`distance_config_over_limit`のリテラル。
  overLimit: Record<LimitItem, number>;
};

type ConstraintSpec = { name: string; table: string; column: string };

export const CONSTRAINT_SPECS: Record<
  `${"distances" | "preset_distances"}.${LimitItem}`,
  ConstraintSpec
> = {
  "distances.distance": {
    name: "distances_distance_max",
    table: "distances",
    column: "distance",
  },
  "distances.totalEnds": {
    name: "distances_total_ends_max",
    table: "distances",
    column: "total_ends",
  },
  "distances.arrowsPerEnd": {
    name: "distances_arrows_per_end_max",
    table: "distances",
    column: "arrows_per_end",
  },
  "preset_distances.distance": {
    name: "preset_distances_distance_max",
    table: "preset_distances",
    column: "distance",
  },
  "preset_distances.totalEnds": {
    name: "preset_distances_total_ends_max",
    table: "preset_distances",
    column: "total_ends",
  },
  "preset_distances.arrowsPerEnd": {
    name: "preset_distances_arrows_per_end_max",
    table: "preset_distances",
    column: "arrows_per_end",
  },
};

const FUNCTION_NAME = "distance_config_over_limit";

// 判定関数の引数名。引数名で値を引くため、並びの入れ替わりも検出できる。
const FUNCTION_ARGUMENTS: Record<LimitItem, string> = {
  distance: "p_distance",
  totalEnds: "p_total_ends",
  arrowsPerEnd: "p_arrows_per_end",
};

// コメントは、中の`<= 100`などを拾わないよう取り除く。
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

type ConstraintDefinition = { table: string; expression: string };

const ALTER_CONSTRAINT =
  /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"?public"?\.)?"?(\w+)"?\s+(ADD|DROP)\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?([^;]*);/gi;

// 制約名ごとに、最後の定義を求める。DROPは定義なしに戻す。
function lastConstraintDefinitions(
  sql: string,
): Map<string, ConstraintDefinition | null> {
  const definitions = new Map<string, ConstraintDefinition | null>();
  for (const match of sql.matchAll(ALTER_CONSTRAINT)) {
    const [, table, action, name, tail] = match;
    definitions.set(
      name,
      action.toUpperCase() === "DROP" ? null : { table, expression: tail },
    );
  }
  return definitions;
}

// 引用符と括弧を取り除いた、CHECKの式。
function normalizedCheck(tail: string): string | undefined {
  const check = /CHECK\s*([\s\S]*)$/i.exec(tail)?.[1];
  if (check === undefined) return undefined;
  return check
    .replace(/\bNOT\s+VALID\b/i, " ")
    .replace(/["()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 制約側は`<列> <= N`(NULLを許す列は`<列> IS NULL OR <列> <= N`)の形だけを読む。
function constraintLimit(spec: ConstraintSpec, tail: string): number {
  const expression = normalizedCheck(tail);
  const match =
    expression === undefined
      ? null
      : /^(?:(\w+) IS NULL OR )?(\w+) <= (\d+)$/i.exec(expression);
  if (
    !match ||
    match[2] !== spec.column ||
    (match[1] && match[1] !== spec.column)
  ) {
    throw new Error(
      `制約${spec.name}のCHECKが「${spec.column} <= 数値」の形で読めない: ${expression ?? tail}`,
    );
  }
  return Number(match[3]);
}

function readConstraints(sql: string): Record<string, number> {
  const definitions = lastConstraintDefinitions(sql);
  const limits: Record<string, number> = {};
  for (const spec of Object.values(CONSTRAINT_SPECS)) {
    const definition = definitions.get(spec.name);
    if (!definition) {
      throw new Error(`制約${spec.name}がマイグレーションに見つからない`);
    }
    if (definition.table !== spec.table) {
      throw new Error(
        `制約${spec.name}の表が${spec.table}でなく${definition.table}になっている`,
      );
    }
    limits[spec.name] = constraintLimit(spec, definition.expression);
  }
  return limits;
}

const FUNCTION_STATEMENT_SOURCE = `(CREATE\\s+(?:OR\\s+REPLACE\\s+)?|DROP\\s+)FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(?:"?public"?\\.)?"?${FUNCTION_NAME}"?\\s*\\(`;

function lastFunctionStatement(sql: string): RegExpExecArray | undefined {
  const pattern = new RegExp(FUNCTION_STATEMENT_SOURCE, "gi");
  let last: RegExpExecArray | undefined;
  for (let match = pattern.exec(sql); match; match = pattern.exec(sql)) {
    last = match;
  }
  return last;
}

// 判定関数の最後の定義の本体(ドル引用符の中)。文字列リテラルは取り除く。
function lastFunctionBody(sql: string): string {
  const last = lastFunctionStatement(sql);
  if (!last || last[1].toUpperCase().startsWith("DROP")) {
    throw new Error(`関数${FUNCTION_NAME}がマイグレーションに見つからない`);
  }
  const rest = sql.slice(last.index + last[0].length);
  const tag = /\$(\w*)\$/.exec(rest);
  if (!tag) {
    throw new Error(`関数${FUNCTION_NAME}の本体(ドル引用符)が読めない`);
  }
  const bodyStart = tag.index + tag[0].length;
  const bodyEnd = rest.indexOf(tag[0], bodyStart);
  if (bodyEnd < 0) {
    throw new Error(`関数${FUNCTION_NAME}の本体の終わりが読めない`);
  }
  return rest.slice(bodyStart, bodyEnd).replace(/'(?:[^']|'')*'/g, " ");
}

// 関数側は、引数名に対する`> N`の整数リテラルを読む。`<=`は要求しない。
function functionLimit(body: string, item: LimitItem): number {
  const argument = FUNCTION_ARGUMENTS[item];
  const literals = [
    ...body.matchAll(new RegExp(`"?\\b${argument}"?\\s*>\\s*(\\d+)`, "g")),
  ];
  if (literals.length !== 1) {
    throw new Error(
      `関数${FUNCTION_NAME}で${argument}に対する「> 数値」が1つに決まらない(${literals.length}件)`,
    );
  }
  return Number(literals[0][1]);
}

function readOverLimit(sql: string): Record<LimitItem, number> {
  const body = lastFunctionBody(sql);
  return {
    distance: functionLimit(body, "distance"),
    totalEnds: functionLimit(body, "totalEnds"),
    arrowsPerEnd: functionLimit(body, "arrowsPerEnd"),
  };
}

// マイグレーションを適用順(渡された順)に読み、後の定義が勝つものとして、上限を求める。
export function readLimitsFromMigrations(sqlTexts: string[]): MigrationLimits {
  if (sqlTexts.length === 0) {
    throw new Error("マイグレーションのSQLが1つも読めない");
  }
  const sql = sqlTexts.map(stripComments).join("\n");
  return { constraints: readConstraints(sql), overLimit: readOverLimit(sql) };
}
