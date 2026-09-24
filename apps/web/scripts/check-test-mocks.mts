// 各ユニットテストが読み込むcoverage対象ファイルのうち、vi.mockされていないもの（モック漏れ）を報告する。
// テスト対象（同じディレクトリの同名ファイル）とテストファイル自身の実行時importを辿り、coverage対象ならモック済みかを判定する。
// coverage対象外のファイルは、実行すればその先のimportも読み込まれるため、推移的に辿る。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

type Matcher = (filePath: string) => boolean;
type Picomatch = (
  patterns: string | string[],
  options?: { dot?: boolean },
) => Matcher;
type CoverageConfig = { include?: string[]; exclude?: string[] };
type VitestConfig = { test?: { coverage?: CoverageConfig } };

const webRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(webRoot, "src");
const extensions = [".ts", ".tsx"];
// 実行されると先のimportも読み込まれるため、coverage対象外でも辿る拡張子。
const followableExtensions = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];
// TypeScriptと同様に、JavaScriptの拡張子で指定されたimportを対応するTypeScriptのファイルへ解決する。
const extensionSubstitutions: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
};
const testFilePattern = /\.test\.tsx?$/;

// picomatchは依存に追加せず、vitestが依存するものを解決して使う。
const requireFromVitest = createRequire(
  createRequire(import.meta.url).resolve("vitest/package.json"),
);
const picomatch = requireFromVitest("picomatch") as Picomatch;

const configModule = (await import(
  pathToFileURL(path.join(webRoot, "vitest.config.mts")).href
)) as { default: VitestConfig };
const coverage = configModule.default.test?.coverage ?? {};
const isIncluded = picomatch(coverage.include ?? [], { dot: true });
const isExcluded = picomatch(coverage.exclude ?? [], { dot: true });

const toRelative = (filePath: string) =>
  path.relative(webRoot, filePath).split(path.sep).join("/");

const isTestFile = (filePath: string) => testFilePattern.test(filePath);

const isCoverageTarget = (filePath: string) => {
  const relative = toRelative(filePath);
  return !isTestFile(filePath) && isIncluded(relative) && !isExcluded(relative);
};

const isFile = (filePath: string) =>
  existsSync(filePath) && statSync(filePath).isFile();

// パッケージのimportはnullを返す。
// 解決できないプロジェクト内のimportはundefinedを返す。
const resolveSpecifier = (
  specifier: string,
  fromFile: string,
): string | null | undefined => {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }
  const ext = path.extname(base);
  const substituted = (extensionSubstitutions[ext] ?? []).map(
    (replacement) => base.slice(0, -ext.length) + replacement,
  );
  const candidates = [
    ...substituted,
    base,
    ...extensions.map((ext) => base + ext),
    ...extensions.map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find(isFile);
};

// bypassMockは、モックの有無に関わらず実モジュールを読み込むimport（vi.importActualと部分モック）を表す。
type Edge = { specifier: string; bypassMock: boolean; mark?: string };
type ParsedFile = { edges: Edge[]; mocks: string[] };
const parseCache = new Map<string, ParsedFile>();

const scriptKinds: Record<string, ts.ScriptKind> = {
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JSX,
  ".jsx": ts.ScriptKind.JSX,
  ".mjs": ts.ScriptKind.JS,
};

const stringArgument = (node: ts.Node | undefined) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

const isDynamicImport = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  node.expression.kind === ts.SyntaxKind.ImportKeyword;

// 括弧・as・satisfies・非nullアサーション・型アサーションを外した式を返す。
const skipOuterExpressions = (node: ts.Expression): ts.Expression => {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return skipOuterExpressions(node.expression);
  }
  return node;
};

const isTypeOnlyImport = (node: ts.ImportDeclaration) => {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  return (
    !clause.name &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
};

const isTypeOnlyExport = (node: ts.ExportDeclaration) => {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly)
  );
};

const viMethod = (node: ts.CallExpression) => {
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "vi"
    ? callee.name.text
    : undefined;
};

// vi.mock("...")とvi.mock(import("..."))の両方の形式からモジュール指定子を取り出す。
const mockSpecifier = (node: ts.CallExpression) => {
  const [first] = node.arguments;
  return first && isDynamicImport(first)
    ? stringArgument(first.arguments[0])
    : stringArgument(first);
};

const isMockTarget = (node: ts.CallExpression) => {
  const parent = node.parent;
  if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) {
    return false;
  }
  const method = viMethod(parent);
  return method === "mock" || method === "doMock";
};

// factoryが引数（importOriginal）を受け取る場合は、実モジュールを読み込む部分モックとして扱う。
const isPartialMock = (node: ts.CallExpression) => {
  const factory = node.arguments[1];
  if (!factory) return false;
  const inner = skipOuterExpressions(factory);
  return (
    (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) &&
    inner.parameters.length > 0
  );
};

const parseFile = (filePath: string): ParsedFile => {
  const cached = parseCache.get(filePath);
  if (cached) return cached;
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKinds[path.extname(filePath)] ?? ts.ScriptKind.TS,
  );
  const parsed: ParsedFile = { edges: [], mocks: [] };
  const addImport = (specifier: string | undefined) => {
    if (specifier) parsed.edges.push({ specifier, bypassMock: false });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      if (!isTypeOnlyImport(node))
        addImport(stringArgument(node.moduleSpecifier));
    } else if (ts.isExportDeclaration(node)) {
      if (!isTypeOnlyExport(node))
        addImport(stringArgument(node.moduleSpecifier));
    } else if (isDynamicImport(node)) {
      // vi.mock(import("..."))の引数はモジュール指定のみで、実行時importではない。
      if (!isMockTarget(node)) addImport(stringArgument(node.arguments[0]));
    } else if (ts.isCallExpression(node)) {
      const method = viMethod(node);
      if (method === "mock" || method === "doMock") {
        const specifier = mockSpecifier(node);
        if (specifier && isPartialMock(node)) {
          parsed.edges.push({
            specifier,
            bypassMock: true,
            mark: "部分モック",
          });
        } else if (specifier && method === "mock") {
          // vi.doMockは巻き上げられず静的importに効かないため、モック済みとしない。
          parsed.mocks.push(specifier);
        }
      } else if (method === "importActual") {
        const specifier = stringArgument(node.arguments[0]);
        if (specifier) {
          parsed.edges.push({
            specifier,
            bypassMock: true,
            mark: "importActual",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  parseCache.set(filePath, parsed);
  return parsed;
};

const findTestFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const fullPath = path.join(dir, name);
    if (statSync(fullPath).isDirectory()) return findTestFiles(fullPath);
    return isTestFile(fullPath) ? [fullPath] : [];
  });

const findProduct = (testFile: string) =>
  extensions.map((ext) => testFile.replace(testFilePattern, ext)).find(isFile);

type Leak = { file: string; via: string[]; marks: string[] };
type Result = { testFile: string; product?: string; leaks: Leak[] };

const checkTest = (testFile: string): Result => {
  const product = findProduct(testFile);
  if (!product) return { testFile, leaks: [] };

  const mocked = new Set(
    parseFile(testFile)
      .mocks.map((specifier) => resolveSpecifier(specifier, testFile))
      .filter((resolved) => typeof resolved === "string"),
  );
  // モックで置き換えられたimportでは実行されないため、実行されたファイルのみを記録する。
  const executed = new Set<string>([testFile, product]);
  const leaks = new Map<string, Leak>();

  const follow = (fromFile: string, via: string[]) => {
    for (const edge of parseFile(fromFile).edges) {
      const resolved = resolveSpecifier(edge.specifier, fromFile);
      if (resolved === null) continue;
      if (resolved === undefined) {
        console.warn(
          `警告: ${toRelative(fromFile)} の "${edge.specifier}" を解決できません`,
        );
        continue;
      }
      if (!edge.bypassMock && mocked.has(resolved)) continue;
      const leak = leaks.get(resolved);
      if (leak && edge.mark && !leak.marks.includes(edge.mark)) {
        leak.marks.push(edge.mark);
      }
      if (executed.has(resolved)) continue;
      executed.add(resolved);
      if (isCoverageTarget(resolved)) {
        leaks.set(resolved, {
          file: resolved,
          via,
          marks: edge.mark ? [edge.mark] : [],
        });
      } else if (followableExtensions.includes(path.extname(resolved))) {
        follow(resolved, [...via, resolved]);
      }
    }
  };

  follow(product, []);
  follow(testFile, []);
  return {
    testFile,
    product,
    leaks: [...leaks.values()].sort((a, b) => a.file.localeCompare(b.file)),
  };
};

const results = findTestFiles(srcRoot).sort().map(checkTest);
const missingProducts = results.filter((result) => !result.product);
const leaking = results.filter((result) => result.leaks.length > 0);
const leakCount = leaking.reduce((sum, result) => sum + result.leaks.length, 0);

for (const result of missingProducts) {
  console.log(`${toRelative(result.testFile)}: テスト対象が見つかりません`);
}
for (const result of leaking) {
  console.log(toRelative(result.testFile));
  for (const leak of result.leaks) {
    const marks = leak.marks.map((mark) => ` (${mark})`).join("");
    const via = leak.via.length
      ? ` (経由: ${leak.via.map(toRelative).join(" -> ")})`
      : "";
    console.log(`  ${toRelative(leak.file)}${marks}${via}`);
  }
}

console.log(
  `\n${results.length}件のテスト中、${leaking.length}件で計${leakCount}件のモック漏れ、${missingProducts.length}件でテスト対象の欠落を検出しました。`,
);
process.exitCode = leakCount > 0 || missingProducts.length > 0 ? 1 : 0;
