// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

// 指定したテーブルのcontent_pathの値。読めなければ失敗する。
function readTemplatePath(table: string): string {
  const lines = readFileSync(configPath, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${table}]`);
  if (start < 0) throw new Error(`config.tomlに[${table}]が無い`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\s*\[/.test(line));
  const section = end < 0 ? rest : rest.slice(0, end);
  const match = section
    .map((line) => /^\s*content_path\s*=\s*"([^"]+)"\s*$/.exec(line))
    .find((m) => m !== null);
  if (!match)
    throw new Error(`config.tomlの[${table}]にcontent_pathが読めない`);
  // content_pathはsupabaseのプロジェクトの根(config.tomlの親の親)からの相対で書かれている。
  return resolve(dirname(configPath), "..", match[1]);
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

  it("メールアドレスの変更に両方のアドレスの認証コードを要する設定(double_confirm_changes)が、有効である", () => {
    // Given
    // 無効にすると新しいアドレス宛ての1通で完了し、盗まれたセッションでアドレスを乗っ取られるため。

    // When
    const enabled = readAuthEmailFlag("double_confirm_changes");

    // Then
    expect(enabled).toBe(true);
  });

  it("メールアドレス変更のメールの本文が、変更前・変更後のアドレスと認証コードの変数を含む", () => {
    // Given

    // When
    const path = readTemplatePath("auth.email.template.email_change");
    const body = existsSync(path) ? readFileSync(path, "utf8") : "";

    // Then
    expect(existsSync(path)).toBe(true);
    expect(body).toContain("{{ .Email }}");
    expect(body).toContain("{{ .NewEmail }}");
    expect(body).toContain("{{ .Token }}");
  });
});
