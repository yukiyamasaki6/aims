import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyExceptions,
  checkSources,
  findViolations,
  isCheckedFile,
  parseArguments,
  RULES,
} from "./check-hardcoded-text.mjs";

function texts(file, source) {
  return findViolations(file, source).map(({ text }) => text);
}

const ATTRIBUTES = [
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "placeholder",
  "title",
  "alt",
  "label",
];
const SUFFIXES = [
  "Label",
  "Title",
  "Text",
  "Message",
  "Description",
  "Placeholder",
];
const PROPERTIES = [
  "label",
  "title",
  "description",
  "message",
  "placeholder",
  "alt",
  "name",
  "short_name",
];

describe("規則1: JSXのテキスト", () => {
  it.each([
    ["日本語のテキスト", "<p>保存しました</p>", ["保存しました"]],
    ["ASCIIのテキスト", "<span>Cancel</span>", ["Cancel"]],
    ["要素と混在したテキスト", "<p>前 <b>{n}</b> 後</p>", ["前", "後"]],
  ])("%sを検出する", (_name, jsx, expected) => {
    expect(texts("a.tsx", `const x = ${jsx};`)).toEqual(expected);
  });

  it.each([
    ["改行と空白だけのテキスト", "<p>\n   </p>"],
    ['{" "}', '<p>{" "}</p>'],
    ['{t("key")}', '<p>{t("key")}</p>'],
    ["{count}", "<p>{count}</p>"],
  ])("%sは検出しない", (_name, jsx) => {
    expect(texts("a.tsx", `const x = ${jsx};`)).toEqual([]);
  });

  it("規則1の番号で示す", () => {
    expect(findViolations("a.tsx", "const x = <p>Save</p>;")[0]?.rule).toBe(
      RULES.jsxText,
    );
  });
});

describe("規則2: 属性", () => {
  it.each(ATTRIBUTES)("列挙の属性%sの静的な文字列を検出する", (name) => {
    expect(texts("a.tsx", `const x = <a ${name}="Hello" />;`)).toEqual([
      "Hello",
    ]);
  });

  it.each(SUFFIXES)("末尾が%sの属性の静的な文字列を検出する", (suffix) => {
    expect(texts("a.tsx", `const x = <a go${suffix}="Hello" />;`)).toEqual([
      "Hello",
    ]);
  });

  it("式の中の静的な文字列と、テンプレートの文字の部分を検出する", () => {
    const source =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 検査対象のソースの文字列
      "const x = <><a title={ok ? 'Yes' : 'No'} /><a aria-label={`削除 ${name}`} /></>;";
    expect(texts("a.tsx", source)).toEqual(["Yes", "No", "削除"]);
  });

  it.each([
    ["式の識別子", 'const x = <a aria-label={t("x")} alt={label} />;'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 検査対象のソースの文字列
    ["式だけのテンプレート", "const x = <a title={`${a}`} />;"],
    [
      "列挙にも末尾の規則にも当たらない属性",
      'const x = <input className="mt-2" type="email" data-testid="a" aria-labelledby="b" modelName="c" />;',
    ],
    ["空の文字列", 'const x = <a title="" alt={""} />;'],
    [
      "比較の相手の文字列",
      'const x = <a lockedMessage={pressed === "arrows"} />;',
    ],
  ])("%sは検出しない", (_name, source) => {
    expect(texts("a.tsx", source)).toEqual([]);
  });
});

describe("規則3: プロパティ", () => {
  it.each(PROPERTIES)("名前%sの文字を含む文字列を検出する", (name) => {
    expect(texts("a.ts", `const x = { ${name}: "送信" };`)).toEqual(["送信"]);
  });

  it("文字列リテラルのキー、入れ子の中、テンプレートを検出する", () => {
    const source =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 検査対象のソースの文字列
      'const x = { "short_name": "AIMS", a: { b: { label: "Deep" } }, title: `Hi ${n}` };';
    expect(texts("a.ts", source)).toEqual(["AIMS", "Deep", "Hi"]);
  });

  it.each([
    ["空の文字列", 'const x = { name: "" };'],
    ["空白だけの文字列", 'const x = { name: "  " };'],
    ["値が識別子や呼び出し", "const x = { label: text, title: t('a') };"],
    [
      "名前が似ていて一致しないもの",
      'const x = { labels: "abc", nameId: "abc" };',
    ],
  ])("%sは検出しない", (_name, source) => {
    expect(texts("a.ts", source)).toEqual([]);
  });
});

describe("規則4: 非ASCII", () => {
  it("文字列とテンプレートの文字の部分の日本語、日本語以外の非ASCIIを検出する", () => {
    const source =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 検査対象のソースの文字列
      "const a = 'あ'; const b = `い${n}う`; const c = 'é'; const d = 'a…';";
    expect(texts("a.ts", source)).toEqual(["あ", "い", "う", "é", "a…"]);
  });

  it("ASCIIだけの文字列は検出しない", () => {
    const source = `"use client";
      const a = "flex"; const b = { type: "button" }; const c = "https://example.com/a";`;
    expect(texts("a.ts", source)).toEqual([]);
  });
});

describe("複数の規則に当たる文字列", () => {
  it("属性の文字列は、規則2の1件だけを出す", () => {
    const found = findViolations("a.tsx", 'const x = <a aria-label="削除" />;');
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe(RULES.attribute);
  });

  it("プロパティの文字列は、規則3の1件だけを出す", () => {
    const found = findViolations("a.ts", 'const x = { label: "送信" };');
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe(RULES.property);
  });
});

describe("D2と対象外", () => {
  it("console.*の引数は、入れ子の中まで検出しない", () => {
    expect(
      texts("a.ts", 'console.error("失敗しました", { label: "詳細" });'),
    ).toEqual([]);
  });

  it("Errorで終わる名前の生成の引数は検出せず、そうでない生成は検出する", () => {
    const source =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 検査対象のソースの文字列
      'new Error("認証に失敗"); new AuthError(`あ${n}日本語`); new Foo("日本語");';
    expect(texts("a.ts", source)).toEqual(["日本語"]);
  });

  it("通常の関数呼び出しの日本語の引数は検出する(newを伴わないErrorの呼び出しを含む)", () => {
    const source =
      'setError("日本語"); form.setError("入力", { label: "詳細" }); Error("失敗");';
    expect(texts("a.ts", source)).toEqual(["日本語", "入力", "詳細", "失敗"]);
  });

  it("import・exportの指定子は検出しない", () => {
    const source = 'import x from "./日本語"; export * from "é";';
    expect(texts("a.ts", source)).toEqual([]);
  });

  it("コメントの日本語は検出しない", () => {
    expect(texts("a.ts", "// コメント\n/* 日本語 */ const x = 1;")).toEqual([]);
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
    ["i18n/messages.ts", true],
    ["features/a/ui/x.test.ts", false],
    ["features/a/ui/x.test.tsx", false],
    ["features/a/ui/x.spec.ts", false],
    ["features/a/ui/x.spec.tsx", false],
    ["features/a/ui/x-test-helpers.ts", false],
    ["features/a/ui/x-test-helpers.tsx", false],
    ["types/supabase.ts", false],
    ["features/a/ui/a-messages.ts", false],
    ["components/screen-messages.ts", false],
    ["app/globals.css", false],
  ])("%s", (file, expected) => {
    expect(isCheckedFile(file)).toBe(expected);
  });
});

describe("例外の一覧", () => {
  const sources = {
    "a.ts": "const a = 'あ'; const b = 'い';",
    "b.ts": "const a = 'あ';",
  };

  it("ファイル単位の行は、そのファイルの違反を出さず、別のファイルの違反は出す", () => {
    const problems = checkSources(sources, [
      { path: "a.ts", reason: "未移行: a" },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("b.ts");
  });

  it("文字列単位の行は、そのファイルのその文字列だけを出さない", () => {
    const problems = checkSources(sources, [
      { path: "a.ts", text: "あ", reason: "境界" },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toContain("a.ts:1");
    expect(problems.join("\n")).toContain('"い"');
    expect(problems.join("\n")).toContain("b.ts:1");
  });

  it.each([
    [
      "ファイル単位でそのファイルに違反がない場合",
      { "c.ts": "const a = 1;" },
      { path: "c.ts", reason: "未移行: c" },
    ],
    [
      "文字列単位で文字列が無い場合",
      { "a.ts": "const a = 'あ';" },
      { path: "a.ts", text: "zzz", reason: "境界" },
    ],
    [
      "パスが存在しない場合",
      { "a.ts": "const a = 1;" },
      { path: "missing.ts", reason: "未移行: x" },
    ],
  ])(
    "違反に当たらない行は、%s失敗にして、その行を示す",
    (_name, files, exception) => {
      const problems = checkSources(files, [exception]);
      expect(
        problems.filter((problem) => problem.includes(exception.reason)),
      ).toHaveLength(1);
    },
  );

  it("理由が無い行は、失敗にする", () => {
    const problems = checkSources({ "a.ts": "const a = 'あ';" }, [
      { path: "a.ts" },
    ]);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("applyExceptionsは、残った違反と未使用の行を分けて返す", () => {
    const violation = { line: 1, text: "あ", rule: RULES.nonAscii };
    const other = { ...violation, text: "い" };
    const used = { path: "a.ts", text: "あ", reason: "境界" };
    const unused = { path: "b.ts", reason: "未移行: x" };
    const result = applyExceptions({ "a.ts": [violation, other], "b.ts": [] }, [
      used,
      unused,
    ]);
    expect(result.remaining).toEqual([{ file: "a.ts", ...other }]);
    expect(result.unused).toEqual([unused]);
  });
});

describe("出力", () => {
  it("複数の違反を全て、ファイルと行と文字列と規則の番号つきで出す", () => {
    const problems = checkSources(
      {
        "a.tsx": "const x = <p>保存</p>;\nconst y = <a title='Hi' />;",
        "a.test.ts": "const x = 'あ';",
      },
      [],
    );
    expect(problems).toEqual([
      `a.tsx:1  ${RULES.jsxText}  "保存"`,
      `a.tsx:2  ${RULES.attribute}  "Hi"`,
    ]);
    expect(RULES.jsxText).toContain("規則1");
    expect(RULES.attribute).toContain("規則2");
  });

  it("違反が無ければ何も出さない", () => {
    expect(checkSources({ "a.ts": "const a = 1;" }, [])).toEqual([]);
  });
});

describe("引数", () => {
  it("既定は、webのsrcと例外の一覧である", () => {
    expect(parseArguments([], "/web")).toEqual({
      src: "/web/src",
      exceptions: "/web/scripts/hardcoded-text-exceptions.json",
    });
  });

  it("不明な引数は例外にする", () => {
    expect(() => parseArguments(["--foo", "x"], "/web")).toThrow("不明な引数");
  });
});

describe("検査のCLI", () => {
  const script = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "check-hardcoded-text.mjs",
  );
  const directories = [];

  afterEach(() => {
    for (const dir of directories.splice(0)) {
      fs.rmSync(dir, { recursive: true });
    }
  });

  function workspace(files, exceptions = []) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardcoded-text-"));
    directories.push(dir);
    for (const [file, source] of Object.entries(files)) {
      const target = path.join(dir, "src", file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, source);
    }
    fs.writeFileSync(path.join(dir, "ex.json"), JSON.stringify(exceptions));
    return dir;
  }

  function execute(dir) {
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--src",
        path.join(dir, "src"),
        "--exceptions",
        path.join(dir, "ex.json"),
      ],
      { encoding: "utf8" },
    );
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  }

  it("違反が無いと、終了コード0で終わる", () => {
    const dir = workspace({ "a.tsx": "export const a = <p>{t('k')}</p>;" });

    expect(execute(dir).status).toBe(0);
  });

  it("違反があると、非0で終わり、違反の行を出す", () => {
    const dir = workspace({ "a.tsx": "export const a = <p>保存</p>;" });

    const { status, output } = execute(dir);

    expect(status).not.toBe(0);
    expect(output).toContain("a.tsx:1");
    expect(output).toContain("保存");
  });

  it("ネストしたディレクトリの*.tsxを探索する", () => {
    const dir = workspace({
      "features/x/ui/deep.tsx": "export const a = <p>Hi</p>;",
    });

    const { status, output } = execute(dir);

    expect(status).not.toBe(0);
    expect(output).toContain("features/x/ui/deep.tsx:1");
  });

  it("対象外のファイルは探索しても違反にしない", () => {
    const dir = workspace({
      "a.test.tsx": "export const a = <p>保存</p>;",
      "a-messages.ts": "export const a = { x: '保存' };",
    });

    expect(execute(dir).status).toBe(0);
  });

  it("例外の一覧のファイルが読まれ、違反を対象外にする", () => {
    const dir = workspace({ "a.tsx": "export const a = <p>保存</p>;" }, [
      { path: "a.tsx", reason: "未移行: a" },
    ]);

    expect(execute(dir).status).toBe(0);
  });

  it("例外の一覧が古いと、非0で終わり、その行を示す", () => {
    const dir = workspace({ "a.tsx": "export const a = 1;" }, [
      { path: "a.tsx", reason: "未移行: a" },
    ]);

    const { status, output } = execute(dir);

    expect(status).not.toBe(0);
    expect(output).toContain("a.tsx");
  });
});
