import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyExceptions,
  checkSources,
  findViolations,
  isCheckedFile,
  parseArguments,
  RULES,
  run,
} from "./check-hardcoded-text.mjs";

function texts(file, source) {
  return findViolations(file, source).map(({ text }) => text);
}

describe("findViolations", () => {
  it("規則1: 空白でないJSXのテキストを検出する", () => {
    expect(texts("a.tsx", "const x = <p>保存 </p>;")).toEqual(["保存"]);
    expect(texts("a.tsx", "const x = <p>Save</p>;")).toEqual(["Save"]);
    expect(texts("a.tsx", "const x = <p>{value}</p>;")).toEqual([]);
    expect(findViolations("a.tsx", "const x = <p>Save</p>;")[0]?.rule).toBe(
      RULES.jsxText,
    );
  });

  it("規則2: 利用者に届く属性の静的な文字列を検出する", () => {
    const source = `const x = <><input placeholder="you@example.com" aria-label="名前" />
      <a closeLabel="Close" data-id="abc" className="mt-2" /></>;`;
    expect(texts("a.tsx", source)).toEqual([
      "you@example.com",
      "名前",
      "Close",
    ]);
  });

  it("規則2: 式とテンプレートの文字の部分を検出する", () => {
    const source =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 検査対象のソースの文字列
      "const x = <><a title={ok ? 'Yes' : 'No'} /><a alt={`logo ${n}`} /><a alt={n} /></>;";
    expect(texts("a.tsx", source)).toEqual(["Yes", "No", "logo"]);
  });

  it("規則2: 空の属性の文字列は検出しない", () => {
    expect(texts("a.tsx", 'const x = <a title="" alt={""} />;')).toEqual([]);
  });

  it("規則3: 利用者に届く名前のプロパティの文字列を検出する", () => {
    const source = `const x = { name: "AIMS", label: ("Start" as string), id: "abc", message: "", title: 12 };`;
    expect(texts("a.ts", source)).toEqual(["AIMS", "Start"]);
  });

  it("規則3: 文字を含まない文字列は検出しない", () => {
    expect(texts("a.ts", 'const x = { name: "-" };')).toEqual([]);
  });

  it("規則4: 非ASCIIの文字を含む全ての文字列とテンプレートを検出する", () => {
    const source =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 検査対象のソースの文字列
      "const a = 'あ'; const b = `い${n}う`; const c = `え`; const d = 'ascii';";
    expect(texts("a.ts", source)).toEqual(["あ", "い", "う", "え"]);
  });

  it("D2: console、例外の生成、コメントは検出しない", () => {
    const source = `// コメント
      console.error("失敗");
      throw new Error("失敗しました");
      throw new AuthError(\`失敗\`);
      throw TypeError("失敗");
      const m = new Map();
      import x from "./あ";`;
    expect(texts("a.ts", source)).toEqual(["./あ"]);
  });

  it("D2: 規則に当たらないASCIIの文字列は検出しない", () => {
    expect(texts("a.ts", 'const x = "foo"; f("bar", `baz`);')).toEqual([]);
  });

  it("文字列でも属性でもないものは検出しない", () => {
    expect(texts("a.ts", "const { name } = o; const t = { label };")).toEqual(
      [],
    );
    expect(texts("a.ts", "const x = { [key]: 'あ' };")).toEqual(["あ"]);
  });

  it("行番号を示す", () => {
    expect(
      findViolations("a.ts", "const a = 1;\nconst b = 'あ';")[0]?.line,
    ).toBe(2);
  });
});

describe("isCheckedFile", () => {
  it.each([
    ["features/a/ui/x.tsx", true],
    ["features/a/ui/x.ts", true],
    ["features/a/ui/x.test.tsx", false],
    ["features/a/ui/x.spec.ts", false],
    ["features/a/ui/x-test-helpers.ts", false],
    ["features/a/ui/x-test-helpers.tsx", false],
    ["features/a/ui/a-messages.ts", false],
    ["components/screen-messages.ts", false],
    ["types/supabase.ts", false],
    ["app/globals.css", false],
  ])("%s", (file, expected) => {
    expect(isCheckedFile(file)).toBe(expected);
  });
});

describe("applyExceptions", () => {
  const violation = { line: 1, text: "あ", rule: RULES.nonAscii };

  it("ファイル全体の例外は、そのファイルの違反を対象外にする", () => {
    const result = applyExceptions({ "a.ts": [violation] }, [
      { path: "a.ts", reason: "未移行: x" },
    ]);
    expect(result).toEqual({ remaining: [], unused: [] });
  });

  it("文字列の例外は、同じ文字列だけを対象外にする", () => {
    const other = { ...violation, text: "い" };
    const exception = { path: "a.ts", text: "あ", reason: "境界" };
    const result = applyExceptions({ "a.ts": [violation, other] }, [exception]);
    expect(result.remaining).toEqual([{ file: "a.ts", ...other }]);
    expect(result.unused).toEqual([]);
  });

  it("どの直書きにも当たらない行は、未使用として返す", () => {
    const whole = { path: "b.ts", reason: "未移行: x" };
    const text = { path: "a.ts", text: "zzz", reason: "境界" };
    const result = applyExceptions({ "a.ts": [violation], "b.ts": [] }, [
      whole,
      text,
    ]);
    expect(result.unused).toEqual([whole, text]);
  });
});

describe("checkSources", () => {
  it("違反と未使用の例外を、ファイルと行と規則つきで示す", () => {
    const problems = checkSources(
      {
        "a.ts": "\nconst x = 'あ';",
        "a.test.ts": "const x = 'あ';",
        "b.ts": "const y = 1;",
      },
      [
        { path: "b.ts", reason: "未移行: x" },
        { path: "b.ts", text: "q", reason: "境界" },
      ],
    );
    expect(problems).toEqual([
      `a.ts:2  ${RULES.nonAscii}  "あ"`,
      "b.ts: どの直書きにも当たらない例外の行です(未移行: x)",
      'b.ts: どの直書きにも当たらない例外の行です(境界) "q"',
    ]);
  });
});

describe("parseArguments / run", () => {
  it("既定は、webのsrcと例外の一覧である", () => {
    const options = parseArguments([], "/web");
    expect(options).toEqual({
      src: "/web/src",
      exceptions: "/web/scripts/hardcoded-text-exceptions.json",
    });
  });

  it("引数で走査の起点と例外の一覧を指定でき、走査して判定する", () => {
    // Given
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardcoded-text-"));
    fs.mkdirSync(path.join(dir, "src", "features"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "features", "a.ts"),
      "const x = 'あ';",
    );
    fs.writeFileSync(path.join(dir, "src", "b.test.ts"), "const x = 'あ';");
    fs.writeFileSync(path.join(dir, "ex.json"), "[]");

    // When
    const options = parseArguments(
      [
        "--src",
        path.join(dir, "src"),
        "--exceptions",
        path.join(dir, "ex.json"),
      ],
      "/web",
    );
    const problems = run(options);

    // Then
    expect(problems).toEqual([`features/a.ts:1  ${RULES.nonAscii}  "あ"`]);
    fs.rmSync(dir, { recursive: true });
  });

  it("不明な引数は例外にする", () => {
    expect(() => parseArguments(["--foo", "x"], "/web")).toThrow("不明な引数");
  });
});
