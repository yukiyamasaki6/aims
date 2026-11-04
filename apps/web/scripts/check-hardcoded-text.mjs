// 利用者に届く文言の直書きを、構文木で検出する(`pnpm lint`の一部)。
// 規則と例外の扱いは、`agents/implementation.md`の「文言」を参照する。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ATTRIBUTE_NAMES = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "placeholder",
  "title",
  "alt",
  "label",
]);
const ATTRIBUTE_SUFFIX = /(Label|Title|Text|Message|Description|Placeholder)$/;
const PROPERTY_NAMES = new Set([
  "label",
  "title",
  "description",
  "message",
  "placeholder",
  "alt",
  "name",
  "short_name",
]);
// 値を作る演算子だけをたどる。比較の相手の文字列は、利用者に届かない。
const VALUE_OPERATORS = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);
const NON_ASCII = /[\u0080-￿]/;
const LETTER = /\p{L}/u;
const EXCLUDED_FILE =
  /(\.(test|spec)\.tsx?$|-test-helpers\.tsx?$|-messages\.ts$|^types\/supabase\.ts$)/;
const SOURCE_FILE = /\.tsx?$/;

export const RULES = {
  jsxText: "規則1: JSXのテキスト",
  attribute: "規則2: 利用者に届く属性の文字列",
  property: "規則3: 利用者に届く名前のプロパティの文字列",
  nonAscii: "規則4: 非ASCIIの文字を含む文字列",
};

function isStringPart(node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
}

// 式に含まれる、静的な文字列とテンプレートの文字の部分を集める。
function stringsOf(expression) {
  if (!expression) return [];
  if (isStringPart(expression)) return [expression];
  if (ts.isTemplateExpression(expression)) {
    return [
      expression.head,
      ...expression.templateSpans.map((span) => span.literal),
    ];
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...stringsOf(expression.whenTrue),
      ...stringsOf(expression.whenFalse),
    ];
  }
  if (
    ts.isBinaryExpression(expression) &&
    VALUE_OPERATORS.has(expression.operatorToken.kind)
  ) {
    return [...stringsOf(expression.left), ...stringsOf(expression.right)];
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return stringsOf(expression.expression);
  }
  return [];
}

function nameOf(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function isExemptCall(node) {
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return callee.text.endsWith("Error");
    return (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "console"
    );
  }
  return false;
}

function attributeStrings(attribute) {
  const initializer = attribute.initializer;
  if (!initializer) return [];
  if (ts.isJsxExpression(initializer)) return stringsOf(initializer.expression);
  return stringsOf(initializer);
}

function isUserFacingAttribute(name) {
  return ATTRIBUTE_NAMES.has(name) || ATTRIBUTE_SUFFIX.test(name);
}

// 1つのノードが当たる規則と文字列の一覧を返す。
function hitsOf(node) {
  if (ts.isJsxText(node)) {
    return node.text.trim() ? [[RULES.jsxText, [node]]] : [];
  }
  if (ts.isJsxAttribute(node)) {
    const name = nameOf(node.name);
    if (name === undefined || !isUserFacingAttribute(name)) return [];
    return [[RULES.attribute, attributeStrings(node)]];
  }
  if (ts.isPropertyAssignment(node)) {
    const name = nameOf(node.name);
    if (name === undefined || !PROPERTY_NAMES.has(name)) return [];
    return [[RULES.property, stringsOf(node.initializer)]];
  }
  if (isStringPart(node)) return [[RULES.nonAscii, [node]]];
  return [];
}

function matchesRule(rule, node) {
  if (rule === RULES.jsxText) return true;
  if (rule === RULES.attribute) return node.text.trim() !== "";
  if (rule === RULES.property) return LETTER.test(node.text);
  return NON_ASCII.test(node.text);
}

// 構文木から違反を集める。違反は、行、文字列、当たった規則である。
export function findViolations(fileName, sourceText) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const violations = [];
  const reported = new Set();
  const visit = (node) => {
    if (isExemptCall(node)) return;
    for (const [rule, nodes] of hitsOf(node)) {
      for (const hit of nodes) {
        if (reported.has(hit.pos) || !matchesRule(rule, hit)) continue;
        reported.add(hit.pos);
        const line =
          source.getLineAndCharacterOfPosition(hit.getStart(source)).line + 1;
        violations.push({ line, text: hit.text.trim(), rule });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

export function isCheckedFile(relativePath) {
  return SOURCE_FILE.test(relativePath) && !EXCLUDED_FILE.test(relativePath);
}

function isFileException(exception) {
  return exception.text === undefined;
}

// 例外を適用し、残った違反と、どの直書きにも当たらない例外の行を返す。
export function applyExceptions(violationsByFile, exceptions) {
  const used = new Set();
  const remaining = [];
  for (const [file, violations] of Object.entries(violationsByFile)) {
    for (const violation of violations) {
      const matched = exceptions.filter(
        (exception) =>
          exception.path === file &&
          (isFileException(exception) || exception.text === violation.text),
      );
      for (const exception of matched) used.add(exception);
      if (matched.length === 0) remaining.push({ file, ...violation });
    }
  }
  const unused = exceptions.filter((exception) => !used.has(exception));
  return { remaining, unused };
}

export function formatProblems({ remaining, unused }) {
  return [
    ...remaining.map(
      ({ file, line, text, rule }) => `${file}:${line}  ${rule}  "${text}"`,
    ),
    ...unused.map(
      (exception) =>
        `${exception.path}: どの直書きにも当たらない例外の行です(${exception.reason})${
          exception.text === undefined ? "" : ` "${exception.text}"`
        }`,
    ),
  ];
}

export function checkSources(sources, exceptions) {
  const violationsByFile = {};
  for (const [file, text] of Object.entries(sources)) {
    if (!isCheckedFile(file)) continue;
    violationsByFile[file] = findViolations(file, text);
  }
  return formatProblems(applyExceptions(violationsByFile, exceptions));
}

function readSources(srcDir) {
  const sources = {};
  for (const entry of fs.readdirSync(srcDir, { recursive: true })) {
    const relative = String(entry).split(path.sep).join("/");
    if (!isCheckedFile(relative)) continue;
    sources[relative] = fs.readFileSync(path.join(srcDir, relative), "utf8");
  }
  return sources;
}

// 引数: --src <走査の起点> --exceptions <例外の一覧のパス>。既定は`src`と`scripts/hardcoded-text-exceptions.json`。
export function parseArguments(argv, webDir) {
  const options = {
    src: path.join(webDir, "src"),
    exceptions: path.join(webDir, "scripts", "hardcoded-text-exceptions.json"),
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (key !== "--src" && key !== "--exceptions") {
      throw new Error(`不明な引数です: ${key}`);
    }
    options[key.slice(2)] = path.resolve(argv[index + 1]);
  }
  return options;
}

export function run(options) {
  const exceptions = JSON.parse(fs.readFileSync(options.exceptions, "utf8"));
  return checkSources(readSources(options.src), exceptions);
}

function main() {
  const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const problems = run(parseArguments(process.argv.slice(2), webDir));
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(`文言の検査に失敗しました(${problems.length}件)。`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
