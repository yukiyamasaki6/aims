// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONSTRAINT_SPECS,
  type LimitItem,
  readLimitsFromMigrations,
} from "./distance-limits-sync-test-helpers";
import { DISTANCE_LIMITS } from "./round-constants";

// cwdに依存しないよう、このファイルの位置からマイグレーションのディレクトリを解く。
const migrationsDirectory = fileURLToPath(
  new URL("../../../../../../supabase/migrations", import.meta.url),
);

// ファイル名の昇順(適用順)に、全てのマイグレーションを読む。
function readMigrations(): string[] {
  const files = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`マイグレーションが1つも無い: ${migrationsDirectory}`);
  }
  return files.map((file) =>
    readFileSync(path.join(migrationsDirectory, file), "utf8"),
  );
}

// 食い違いごとに、項目名・DB側の値・フロントの値を示す。
function mismatchesOf(
  actual: Record<string, number>,
  keyOf: (item: LimitItem) => string[],
): string[] {
  const items = Object.keys(DISTANCE_LIMITS) as LimitItem[];
  return items.flatMap((item) =>
    keyOf(item)
      .filter((key) => actual[key] !== DISTANCE_LIMITS[item])
      .map(
        (key) =>
          `${item}: ${key}のDB側の値${actual[key]}がフロントの値${DISTANCE_LIMITS[item]}と違う`,
      ),
  );
}

describe("距離の上限のフロントとDBの一致", () => {
  it("distancesとpreset_distancesの各上限制約の値が、フロントの上限と一致する", () => {
    // Given
    // When
    const { constraints } = readLimitsFromMigrations(readMigrations());

    // Then
    const mismatches = mismatchesOf(constraints, (item) => [
      CONSTRAINT_SPECS[`distances.${item}`].name,
      CONSTRAINT_SPECS[`preset_distances.${item}`].name,
    ]);
    expect(mismatches).toEqual([]);
  });

  it("上限の判定関数の3つのリテラルが、フロントの上限と一致する", () => {
    // Given
    // When
    const { overLimit } = readLimitsFromMigrations(readMigrations());

    // Then
    const mismatches = mismatchesOf(overLimit, (item) => [item]);
    expect(mismatches).toEqual([]);
  });
});
