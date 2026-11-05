// 文言の一覧に残った、本番のコードから参照されないキーを、型検査器で検出する(`pnpm lint`の一部)。
// 規則と例外の扱いは、`agents/implementation.md`の「文言」を参照する。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SOURCE_FILE = /\.tsx?$/;
const EXCLUDED_FILE = /(\.d\.ts$|\.(test|spec)\.tsx?$|-test-helpers\.tsx?$)/;
const INTL_MODULES = new Set([
  "next-intl",
  "next-intl/server",
  "use-intl",
  "use-intl/core",
]);
const TRANSLATOR_FACTORIES = new Set([
  "useTranslations",
  "getTranslations",
  "createTranslator",
]);
const NAMESPACE_FACTORIES = new Set(["useTranslations", "getTranslations"]);

function isCheckedFile(relativePath) {
  return SOURCE_FILE.test(relativePath) && !EXCLUDED_FILE.test(relativePath);
}

// 展開できない式を表す。呼び出し側で解釈できない参照として報告する。
class Unresolvable extends Error {}

function isWrapper(node) {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  );
}

// 値の読み取りを変えない包み(括弧、`as`、`satisfies`、`!`、`await`)を外す。
function strip(expression) {
  let node = expression;
  while (isWrapper(node) || ts.isAwaitExpression(node)) node = node.expression;
  return node;
}

// 識別子を、包みごと外側へたどる。
function outermost(node) {
  let current = node;
  while (isWrapper(current.parent) && current.parent.expression === current) {
    current = current.parent;
  }
  return current;
}

function stringLiteralText(node) {
  if (!node) return undefined;
  const inner = strip(node);
  return ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)
    ? inner.text
    : undefined;
}

// 型が取り得る文字列の集合。展開できなければUnresolvableを投げる。
function stringsOfType(checker, type) {
  if (type.flags & (ts.TypeFlags.TypeParameter | ts.TypeFlags.IndexedAccess)) {
    const constraint = checker.getBaseConstraintOfType(type);
    if (!constraint || constraint === type) throw new Unresolvable();
    return stringsOfType(checker, constraint);
  }
  if (type.isUnion()) {
    return type.types.flatMap((member) => stringsOfType(checker, member));
  }
  if (type.isStringLiteral()) return [type.value];
  if (
    type.flags &
    (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never)
  ) {
    return [];
  }
  throw new Unresolvable();
}

function product(prefixes, suffixes) {
  return prefixes.flatMap((prefix) =>
    suffixes.map((suffix) => `${prefix}${suffix}`),
  );
}

// キーの引数の式が取り得る文字列の集合。
function stringsOfExpression(checker, expression) {
  if (ts.isParenthesizedExpression(expression)) {
    return stringsOfExpression(checker, expression.expression);
  }
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return [expression.text];
  }
  if (ts.isTemplateExpression(expression)) {
    let results = [expression.head.text];
    for (const span of expression.templateSpans) {
      const parts = stringsOfType(
        checker,
        checker.getTypeAtLocation(span.expression),
      );
      results = product(product(results, parts), [span.literal.text]);
    }
    return results;
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...stringsOfExpression(checker, expression.whenTrue),
      ...stringsOfExpression(checker, expression.whenFalse),
    ];
  }
  return stringsOfType(checker, checker.getTypeAtLocation(expression));
}

function isStringType(type) {
  return Boolean(
    type.flags &
      (ts.TypeFlags.StringLike |
        ts.TypeFlags.TemplateLiteral |
        ts.TypeFlags.String),
  );
}

function declarationOf(symbol) {
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}

function lineOf(node) {
  const source = node.getSourceFile();
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function findAppConfig(source) {
  for (const statement of source.statements) {
    const isIntlModule =
      ts.isModuleDeclaration(statement) &&
      ts.isStringLiteral(statement.name) &&
      statement.name.text === "next-intl";
    if (!isIntlModule) continue;
    const found = (statement.body?.statements ?? []).find(
      (inner) =>
        ts.isInterfaceDeclaration(inner) && inner.name.text === "AppConfig",
    );
    if (found) return found;
  }
  return undefined;
}

// `messages`の設定にある`AppConfig`の`Messages`の型を求める。
function registeredMessagesType(checker, source) {
  const member = findAppConfig(source)?.members.find(
    (candidate) =>
      ts.isPropertySignature(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === "Messages",
  );
  if (!member?.type) {
    throw new Error(
      `${source.fileName}に、next-intlのAppConfigのMessagesの登録が見つかりません。`,
    );
  }
  return checker.getTypeFromTypeNode(member.type);
}

function isNestedTable(type) {
  return Boolean(
    type.flags & ts.TypeFlags.Object && type.getCallSignatures().length === 0,
  );
}

// 型の性質を1つ読み、文字列の葉ならキーに足し、入れ子の表なら再帰でたどる。
function collectProperty(checker, keys, property, prefix, locationNode) {
  const declaration = declarationOf(property);
  const propertyType = checker.getTypeOfSymbolAtLocation(
    property,
    declaration ?? locationNode,
  );
  const keyPath = prefix === "" ? property.name : `${prefix}.${property.name}`;
  if (isStringType(propertyType)) {
    keys.set(keyPath, {
      file: declaration?.getSourceFile().fileName,
      line: declaration ? lineOf(declaration) : 1,
    });
  } else if (isNestedTable(propertyType)) {
    for (const child of checker.getPropertiesOfType(propertyType)) {
      collectProperty(checker, keys, child, keyPath, locationNode);
    }
  } else {
    throw new Error(
      `文言の一覧のキー${keyPath}の型が、文字列でも入れ子の表でもありません。`,
    );
  }
}

// 型の性質を再帰でたどり、文字列の葉を全てのキーとして集める。
function collectMessageKeys(checker, messagesType, locationNode) {
  const keys = new Map();
  for (const property of checker.getPropertiesOfType(messagesType)) {
    collectProperty(checker, keys, property, "", locationNode);
  }
  return keys;
}

function importedFactories(source) {
  const names = new Map();
  for (const statement of source.statements) {
    const bindings = statement.importClause?.namedBindings;
    const isIntlImport =
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      INTL_MODULES.has(statement.moduleSpecifier.text);
    if (!isIntlImport || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (TRANSLATOR_FACTORIES.has(imported))
        names.set(element.name.text, imported);
    }
  }
  return names;
}

function isReturnTypeOfFactory(typeNode) {
  return (
    Boolean(typeNode) &&
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    typeNode.typeName.text === "ReturnType" &&
    typeNode.typeArguments?.length === 1
  );
}

// 型の注記`ReturnType<typeof useTranslations<"ns">>`から名前空間を取り出す。当たらなければundefined。
function namespaceOfAnnotation(typeNode, factories) {
  if (!isReturnTypeOfFactory(typeNode)) return undefined;
  const query = typeNode.typeArguments[0];
  if (!ts.isTypeQueryNode(query) || !ts.isIdentifier(query.exprName))
    return undefined;
  if (!NAMESPACE_FACTORIES.has(factories.get(query.exprName.text)))
    return undefined;
  const argument = query.typeArguments?.[0];
  if (
    !argument ||
    !ts.isLiteralTypeNode(argument) ||
    !ts.isStringLiteral(argument.literal)
  ) {
    return undefined;
  }
  return { namespace: argument.literal.text };
}

// `createTranslator`の引数のオブジェクトの1つの要素が与える名前空間。与えなければundefined。
function namespaceOfProperty(checker, property) {
  if (ts.isSpreadAssignment(property)) {
    const spread = checker.getTypeAtLocation(property.expression);
    if (spread.getProperty("namespace")) throw new Unresolvable();
    return undefined;
  }
  if (property.name?.text !== "namespace") return undefined;
  const namespace = ts.isPropertyAssignment(property)
    ? stringLiteralText(property.initializer)
    : undefined;
  if (namespace === undefined) throw new Unresolvable();
  return namespace;
}

function namespaceOfCreateTranslator(checker, argument) {
  const options = argument && strip(argument);
  if (!options || !ts.isObjectLiteralExpression(options))
    throw new Unresolvable();
  let namespace;
  for (const property of options.properties) {
    namespace = namespaceOfProperty(checker, property) ?? namespace;
  }
  return namespace;
}

// 翻訳関数の取得の呼び出しの名前空間。解釈できなければUnresolvableを投げる。
function namespaceOfFactoryCall(checker, factory, call) {
  const [argument] = call.arguments;
  if (factory === "createTranslator")
    return namespaceOfCreateTranslator(checker, argument);
  if (!argument) return undefined;
  const namespace = stringLiteralText(argument);
  if (namespace === undefined) throw new Unresolvable();
  return namespace;
}

function compactText(node) {
  return node.getText().replace(/\s+/g, " ");
}

function loadProgram(project) {
  const projectPath = path.resolve(project);
  const projectDir = path.dirname(projectPath);
  const read = ts.readConfigFile(projectPath, ts.sys.readFile);
  const parsed = read.error
    ? { errors: [read.error] }
    : ts.parseJsonConfigFileContent(read.config, ts.sys, projectDir);
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, "\n"),
        )
        .join("\n"),
    );
  }
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: {
      ...parsed.options,
      incremental: false,
      composite: false,
      tsBuildInfoFile: undefined,
      noEmit: true,
    },
  });
  return { program, projectDir, srcDir: path.join(projectDir, "src") };
}

function toSlashes(relative) {
  return relative.split(path.sep).join("/");
}

function isFactoryCall(node, factories) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    factories.has(node.expression.text)
  );
}

function bindFactoryCall(context, declaration, call, factories) {
  context.boundCalls.add(call);
  try {
    const factory = factories.get(call.expression.text);
    context.translators.set(
      declaration,
      namespaceOfFactoryCall(context.checker, factory, call),
    );
  } catch (error) {
    if (!(error instanceof Unresolvable)) throw error;
    context.report(call);
  }
}

function collectFromDeclaration(context, node, factories) {
  const initializer = strip(node.initializer);
  if (isFactoryCall(initializer, factories)) {
    bindFactoryCall(context, node, initializer, factories);
  } else if (ts.isIdentifier(initializer)) {
    context.aliasCandidates.push({ declaration: node, target: initializer });
  }
}

function collectNode(context, node, factories) {
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer &&
    ts.isIdentifier(node.name)
  ) {
    collectFromDeclaration(context, node, factories);
  }
  if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
    const annotated = namespaceOfAnnotation(node.type, factories);
    if (annotated) context.translators.set(node, annotated.namespace);
  }
}

// 段階1: 翻訳関数を宣言の単位で集める(宣言 -> 名前空間)。
function collectTranslators(context, sources) {
  for (const source of sources) {
    const factories = importedFactories(source);
    const collect = (node) => {
      collectNode(context, node, factories);
      ts.forEachChild(node, collect);
    };
    collect(source);
  }
}

// 別名は、取得より前に書かれることがあるので、増えなくなるまで繰り返す。
function resolveAliases(context) {
  const { checker, translators, aliasCandidates, aliasDeclarations } = context;
  for (let changed = true; changed; ) {
    changed = false;
    for (const { declaration, target } of aliasCandidates) {
      if (translators.has(declaration)) continue;
      const targetDeclaration = declarationOf(
        checker.getSymbolAtLocation(target),
      );
      if (targetDeclaration && translators.has(targetDeclaration)) {
        translators.set(declaration, translators.get(targetDeclaration));
        aliasDeclarations.add(declaration);
        changed = true;
      }
    }
  }
}

function markUsed(context, namespace, keys) {
  for (const key of keys) {
    const full = namespace === undefined ? key : `${namespace}.${key}`;
    if (context.allKeys.has(full)) context.used.add(full);
  }
}

function handleCall(context, call, namespace) {
  const [argument] = call.arguments;
  if (!argument || ts.isSpreadElement(argument)) {
    context.report(call);
    return;
  }
  try {
    markUsed(
      context,
      namespace,
      stringsOfExpression(context.checker, argument),
    );
  } catch (error) {
    if (!(error instanceof Unresolvable)) throw error;
    context.report(argument);
  }
}

function isTranslatorArgument(context, call, node) {
  const signature = context.checker.getResolvedSignature(call);
  const parameter = signature?.parameters[call.arguments.indexOf(node)];
  return (
    Boolean(parameter) && context.translators.has(declarationOf(parameter))
  );
}

// 翻訳関数の識別子の使い方が、呼び出し・別名・認識した引数への受け渡しのどれかか確かめる。
function handleUse(context, identifier, declaration) {
  const node = outermost(identifier);
  const parent = node.parent;
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === node &&
    context.aliasDeclarations.has(parent)
  ) {
    return;
  }
  if (ts.isCallExpression(parent) && parent.expression === node) {
    handleCall(context, parent, context.translators.get(declaration));
    return;
  }
  if (
    ts.isCallExpression(parent) &&
    parent.arguments.includes(node) &&
    isTranslatorArgument(context, parent, node)
  ) {
    return;
  }
  context.report(ts.isPropertyAccessExpression(parent) ? parent : node);
}

// `typeof t`の`t`は型の位置にあり、値を読まないので、参照に数えない。
function isInTypeQuery(identifier) {
  let node = identifier;
  while (ts.isQualifiedName(node.parent)) node = node.parent;
  return ts.isTypeQueryNode(node.parent);
}

function translatorDeclarationOf(context, identifier) {
  const parent = identifier.parent;
  if (isInTypeQuery(identifier)) return undefined;
  const isDeclarationName =
    (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) &&
    parent.name === identifier;
  const isShorthandName =
    ts.isShorthandPropertyAssignment(parent) && parent.name === identifier;
  if (isDeclarationName || isShorthandName) return undefined;
  const declaration = declarationOf(
    context.checker.getSymbolAtLocation(identifier),
  );
  return declaration && context.translators.has(declaration)
    ? declaration
    : undefined;
}

function isUnboundFactoryCall(context, factories, node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    factories.has(node.expression.text) &&
    !context.boundCalls.has(node)
  );
}

function checkShorthand(context, node) {
  const declaration = declarationOf(
    context.checker.getShorthandAssignmentValueSymbol(node),
  );
  if (declaration && context.translators.has(declaration)) context.report(node);
}

function checkNode(context, factories, node) {
  if (isUnboundFactoryCall(context, factories, node)) context.report(node);
  if (ts.isShorthandPropertyAssignment(node)) {
    checkShorthand(context, node);
  } else if (ts.isIdentifier(node)) {
    const declaration = translatorDeclarationOf(context, node);
    if (declaration) handleUse(context, node, declaration);
  }
}

// 段階2: 取得の呼び出しの束縛先と、翻訳関数の使い方を確かめる。
function checkUses(context, sources) {
  for (const source of sources) {
    const factories = importedFactories(source);
    const visit = (node) => {
      checkNode(context, factories, node);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

// 1つのプロジェクトの、全てのキーと使用済みのキーと解釈できない参照を求める。
function analyzeProject({ project, messages }) {
  const { program, projectDir, srcDir } = loadProgram(project);
  const checker = program.getTypeChecker();
  const messagesPath = path.resolve(messages);
  const messagesSource = program.getSourceFile(messagesPath);
  if (!messagesSource) {
    throw new Error(`文言の設定がプロジェクトに含まれません: ${messagesPath}`);
  }
  const allKeys = collectMessageKeys(
    checker,
    registeredMessagesType(checker, messagesSource),
    messagesSource,
  );
  const displayPath = (absolute) => {
    const fromSrc = path.relative(srcDir, absolute);
    return toSlashes(
      fromSrc.startsWith("..") ? path.relative(projectDir, absolute) : fromSrc,
    );
  };
  // 除外のファイルは、使用の集計にも解釈できない参照の報告にも入れない。
  const sources = program.getSourceFiles().filter((source) => {
    const relative = path.relative(srcDir, source.fileName);
    return !relative.startsWith("..") && isCheckedFile(toSlashes(relative));
  });
  const unresolved = [];
  const context = {
    checker,
    allKeys,
    used: new Set(),
    unresolved,
    translators: new Map(),
    boundCalls: new Set(),
    aliasCandidates: [],
    aliasDeclarations: new Set(),
    report: (node, text = compactText(node)) => {
      unresolved.push({
        file: displayPath(node.getSourceFile().fileName),
        line: lineOf(node),
        text,
      });
    },
  };
  collectTranslators(context, sources);
  resolveAliases(context);
  checkUses(context, sources);
  return {
    keys: new Map(
      [...allKeys].map(([key, where]) => [
        key,
        { file: where.file ? displayPath(where.file) : "", line: where.line },
      ]),
    ),
    used: context.used,
    unresolved,
  };
}

function hasReason(exception) {
  return typeof exception.reason === "string" && exception.reason.trim() !== "";
}

function matchesKey(pattern, key) {
  return pattern.endsWith(".*")
    ? key.startsWith(`${pattern.slice(0, -1)}`)
    : pattern === key;
}

// 1行の例外の不備と、その行が使用済みにするキーを返す。
function checkException(analysis, unresolvedFiles, exception) {
  const invalid = [];
  const used = [];
  if (!hasReason(exception)) {
    invalid.push(`${exception.path}: 例外の行に理由がありません`);
  }
  if (!unresolvedFiles.has(exception.path)) {
    invalid.push(
      `${exception.path}: 解釈できない参照が無いファイルへの例外の行です(${exception.reason ?? ""})`,
    );
    return { invalid, used };
  }
  for (const pattern of exception.keys ?? []) {
    const matched = [...analysis.keys.keys()].filter((key) =>
      matchesKey(pattern, key),
    );
    if (matched.length === 0) {
      invalid.push(
        `${exception.path}: どのキーにも当たらない経路です "${pattern}"`,
      );
    }
    used.push(...matched);
  }
  return { invalid, used };
}

// 例外を適用し、未使用のキーと、残った解釈できない参照と、例外の不備を返す。
function applyExceptions(analysis, exceptions) {
  const used = new Set(analysis.used);
  const invalid = [];
  const unresolvedFiles = new Set(analysis.unresolved.map(({ file }) => file));
  for (const exception of exceptions) {
    const checked = checkException(analysis, unresolvedFiles, exception);
    invalid.push(...checked.invalid);
    for (const key of checked.used) used.add(key);
  }
  const excepted = new Set(exceptions.map(({ path: file }) => file));
  return {
    unused: [...analysis.keys]
      .filter(([key]) => !used.has(key))
      .map(([key, where]) => ({ key, ...where })),
    unresolved: analysis.unresolved.filter(({ file }) => !excepted.has(file)),
    invalid,
  };
}

function formatProblems({ unused, unresolved, invalid }) {
  return [
    ...unused.map(
      ({ key, file, line }) =>
        `${file}:${line}  未使用のキー  ${key}  (本番のコードから参照するか、文言の一覧から消す)`,
    ),
    ...unresolved.map(
      ({ file, line, text }) =>
        `${file}:${line}  解釈できない参照  ${text}  (キーをリテラルか種類の型で書くか、例外に宣言する)`,
    ),
    ...invalid,
  ];
}

function main() {
  const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const options = {
    project: path.join(webDir, "tsconfig.json"),
    messages: path.join(webDir, "src", "i18n", "messages.ts"),
  };
  const exceptionsPath = path.join(
    webDir,
    "scripts",
    "unused-message-keys-exceptions.json",
  );
  try {
    const exceptions = JSON.parse(fs.readFileSync(exceptionsPath, "utf8"));
    const problems = formatProblems(
      applyExceptions(analyzeProject(options), exceptions),
    );
    for (const problem of problems) console.error(problem);
    if (problems.length > 0) {
      console.error(
        `未使用の文言キーの検査に失敗しました(${problems.length}件)。`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`未使用の文言キーの検査を実行できません: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
