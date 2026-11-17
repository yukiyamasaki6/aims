import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

const files = sourceFiles(SRC).map((file) => ({
  name: path.relative(SRC, file).split(path.sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

// import と export ... from の両方の取り込み元を、別名・相対パスの表記を問わず集める。
function specifiers(text: string): string[] {
  return [...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
}

function filesWhere(predicate: (text: string) => boolean): string[] {
  return files
    .filter((file) => predicate(file.text))
    .map((file) => file.name)
    .sort();
}

// 共通ダイアログを使う対象(app/open-focus/test-design.md の「対象」と「例外」)。
const DIALOG_USERS = [
  "components/ui/confirm-dialog.tsx",
  "features/rounds/ui/distance-edit-fields.tsx",
  "features/rounds/ui/history-distance-dialog.tsx",
  "features/rounds/ui/history-target-selection.tsx",
  "features/rounds/ui/round-config-panel.tsx",
  "features/rounds/ui/save-preset-dialog.tsx",
  "features/rounds/ui/target-face-picker.tsx",
  "features/settings/ui/settings-panel.tsx",
];

// 入力欄でない先頭の操作へフォーカスを移す例外。
const INITIAL_FOCUS_EXCEPTIONS = ["features/settings/ui/settings-panel.tsx"];

// 共通ダイアログを使わず、自動または操作の結果としてフォーカスを移す許可の一覧(理由を1行で持つ)。
const FOCUS_ALLOWED: Record<string, string> = {
  "components/ui/dialog.tsx":
    "開いたときのポップアップ(入力欄でない)への同期の移動",
  "features/auth/ui/signin-form.tsx": "利用者の操作への応答(次の入力欄へ進む)",
  "features/navigation/ui/left-panel.tsx":
    "閉じた後の戻り先と、メニュー内のキーボード操作への応答",
  "features/rounds/ui/history-filter-panel.tsx":
    "開いたときの領域(入力欄でない)への移動",
  "features/rounds/ui/rounds-history.tsx": "閉じた後の起点(ボタン)への復帰",
};

describe("開いたときのフォーカスの走査", () => {
  it("共通ダイアログのimport元は、対象と例外の表のファイルだけである", () => {
    // Given

    // When
    const users = filesWhere((text) =>
      specifiers(text).some((specifier) =>
        /^(@\/components\/ui|\.{1,2}(\/[^/]+)*)\/dialog$|^\.\/dialog$/.test(
          specifier,
        ),
      ),
    ).filter((name) => name !== "components/ui/dialog.tsx");

    // Then
    expect(users).toEqual(DIALOG_USERS);
  });

  it("ライブラリのdialogを直接importするのは共通ダイアログだけである", () => {
    // Given

    // When
    const direct = filesWhere((text) =>
      specifiers(text).includes("@base-ui/react/dialog"),
    );

    // Then
    expect(direct).toEqual(["components/ui/dialog.tsx"]);
  });

  it("フォーカス先(focusTarget)を指定するのは、例外の表のファイルだけである", () => {
    // Given

    // When
    const specified = filesWhere((text) => /\bfocusTarget\b/.test(text)).filter(
      (name) => name !== "components/ui/dialog.tsx",
    );

    // Then
    expect(specified).toEqual(INITIAL_FOCUS_EXCEPTIONS);
  });

  it("Base UIのinitialFocusを直接指定するファイルはない", () => {
    // Given

    // When
    const specified = filesWhere((text) =>
      /\binitialFocus\b/.test(text),
    ).filter((name) => name !== "components/ui/dialog.tsx");

    // Then
    expect(specified).toEqual([]);
  });

  it("autoFocusと.focus(の呼び出しは、許可の一覧のファイルだけが持つ", () => {
    // Given
    const allowed = Object.keys(FOCUS_ALLOWED).sort();

    // When
    const focusing = filesWhere((text) =>
      /\bautoFocus\b|\.focus\(|\bfocus\(\{/.test(text),
    );

    // Then
    expect(focusing).toEqual(allowed);
  });
});
