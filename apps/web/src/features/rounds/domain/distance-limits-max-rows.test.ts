// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DISTANCE_LIMITS } from "./round-constants";

// cwdに依存しないよう、このファイルの位置から設定ファイルを解く。
const configPath = fileURLToPath(
  new URL("../../../../../../supabase/config.toml", import.meta.url),
);

// [api]の`max_rows`。コメント行は読まず、読めなければ失敗する。
function readMaxRows(): number {
  const lines = readFileSync(configPath, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"));
  const apiStart = lines.findIndex((line) => line.trim() === "[api]");
  if (apiStart < 0) throw new Error("config.tomlに[api]が無い");
  const rest = lines.slice(apiStart + 1);
  const end = rest.findIndex((line) => /^\s*\[/.test(line));
  const section = end < 0 ? rest : rest.slice(0, end);
  const match = section
    .map((line) => /^\s*max_rows\s*=\s*(\d+)\s*$/.exec(line))
    .find((m) => m !== null);
  if (!match) throw new Error("config.tomlの[api]にmax_rowsが読めない");
  return Number(match[1]);
}

describe("距離の上限とAPIの最大行数", () => {
  it("1つの距離の最大の矢数(総エンド数の上限×矢数の上限)が、max_rows以下で、取得で欠けない", () => {
    // Given
    // When
    const maxRows = readMaxRows();

    // Then
    const maxShots = DISTANCE_LIMITS.totalEnds * DISTANCE_LIMITS.arrowsPerEnd;
    expect(maxShots).toBeLessThanOrEqual(maxRows);
  });
});
