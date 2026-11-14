// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// cwdに依存しないよう、このファイルの位置から設定ファイルを解く。
const configPath = fileURLToPath(
  new URL("../../../../../../supabase/config.toml", import.meta.url),
);

// [auth.email]の真偽値のキー。コメント行は読まず、読めなければ失敗する。
function readAuthEmailFlag(key: string): boolean {
  const lines = readFileSync(configPath, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"));
  const start = lines.findIndex((line) => line.trim() === "[auth.email]");
  if (start < 0) throw new Error("config.tomlに[auth.email]が無い");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\s*\[/.test(line));
  const section = end < 0 ? rest : rest.slice(0, end);
  const match = section
    .map((line) =>
      new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*$`).exec(line),
    )
    .find((m) => m !== null);
  if (!match) throw new Error(`config.tomlの[auth.email]に${key}が読めない`);
  return match[1] === "true";
}

describe("認証サービスのメールの設定", () => {
  it("メールの認証コードによる再認証(secure_password_change)は、無効のままである", () => {
    // Given
    // 有効にすると、作成から24時間以内のセッションが無検査になり、現在のパスワードとコードの両方を要する構成も採らないため。

    // When
    const enabled = readAuthEmailFlag("secure_password_change");

    // Then
    expect(enabled).toBe(false);
  });

  it("パスワードの更新に現在のパスワードを要する設定(require_current_password)が、有効である", () => {
    // Given

    // When
    const enabled = readAuthEmailFlag("require_current_password");

    // Then
    expect(enabled).toBe(true);
  });
});
