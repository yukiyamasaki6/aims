# Lintルール一覧

Biomeの規則の採否と、このプロジェクトでの理由。
理由の「一貫性」はREADMEのBiomeの役割(コードの一貫性のガードレール)、「型安全」はREADMEのTypeScriptの採用理由(型安全)、「複雑さの抑制」は`agents/implementation.md`の「コードの複雑さ」を指す。

## style

| 規則 | 採否 | 理由 |
| --- | --- | --- |
| noCommonJs | 採用 | 一貫性。TypeScriptと`.mjs`のスクリプトで使うESMにそろえる |
| noContinue | 不採用 | `agents/implementation.md`で、`continue`による早期の打ち切りを入れ子を浅くする書き方として推奨している |
| noDefaultExport | 採用 | 一貫性。名前付きの書き出しにそろえる(Next.jsが既定の書き出しを求めるファイルとツールの設定ファイルは対象外) |
| noDescendingSpecificity | 採用 | 一貫性。Tailwind CSSとshadcn/uiのスタイル(`globals.css`)で、後に書いたセレクタが効かない誤りを防ぐ |
| noDoneCallback | 採用 | 一貫性。Vitestの非同期のテストを`async`の形にそろえる |
| noEnum | 採用 |  |
| noExcessiveClassesPerFile | 採用 | 複雑さの抑制。1ファイルに複数のクラスを置かせない |
| noExcessiveLinesPerFile | 採用 | 複雑さの抑制。関数の長さの上限に加え、ファイルの長さにも上限を置く |
| noExportedImports | 採用 |  |
| noHexColors | 採用 | 一貫性。CSSの色を、shadcn/uiのテーマ(`oklch`)と同じ色関数の形にそろえる |
| noImplicitBoolean | 採用 |  |
| noIncrementDecrement | 不採用 | 防ぐ誤り(自動セミコロン挿入)は、Biomeのフォーマッタが常にセミコロンを付けるため起きない |
| noInferrableTypes | 採用 |  |
| noJsxLiterals | 不採用 | 文字列の管理が形式化されていない(多言語対応はロードマップのv1.6.0)。形式化した後に導入する |
| noMagicNumbers | 採用 |  |
| noMultiAssign | 採用 | 複雑さの抑制。1つの式で複数の変数に代入させない |
| noMultilineString | 採用 |  |
| noNamespace | 採用 |  |
| noNegationElse | 採用 | 複雑さの抑制。`else`のある条件を否定で書かせない |
| noNestedTernary | 採用 | 複雑さの抑制。三項演算子を入れ子にさせない |
| noNonNullAssertion | 採用 | 型安全。`!`で型検査を外させない |
| noParameterAssign | 採用 | 複雑さの抑制。引数への再代入を禁じ、値の流れを追いやすくする |
| noParameterProperties | 採用 |  |
| noProcessEnv | 採用 | 一貫性。SupabaseとTurnstileの環境変数を読む場所を集める(読むモジュール、ツールの設定ファイル、テストは対象外) |
| noRestrictedGlobals | 採用 | 型安全。暗黙のグローバル`event`と`error`を誤って使わせない |
| noRestrictedImports | 採用 | 制限するモジュールは未設定。設定したときに効くよう有効にしておく |
| noRestrictedTypes | 採用 | 制限する型は未設定。設定したときに効くよう有効にしておく |
| noRootType | 採用 | GraphQLは使っていない。使い始めたときの一貫性のため有効にしておく |
| noShoutyConstants | 採用 |  |
| noSubstr | 採用 |  |
| noTernary | 不採用 | ReactのJSXでは条件の表示に三項演算子を使う。読みにくさの原因の入れ子は`noNestedTernary`が止める |
| noUnusedTemplateLiteral | 採用 |  |
| noUselessElse | 採用 | 複雑さの抑制。早期returnの後の`else`をなくし、入れ子を浅くする |
| noValueAtRule | 採用 | CSS Modulesは使っていない(Tailwind CSSを使う)。使い始めたときの一貫性のため有効にしておく |
| noYodaExpression | 採用 |  |
| useArrayLiterals | 採用 |  |
| useAsConstAssertion | 採用 | 型安全。リテラルの型を`as const`で固定する形にそろえる |
| useAtIndex | 採用 |  |
| useBlockStatements | 採用 |  |
| useCollapsedElseIf | 採用 | 複雑さの抑制。`else`の中の`if`を`else if`にして入れ子を浅くする |
| useCollapsedIf | 採用 | 複雑さの抑制。入れ子の`if`をまとめる |
| useConsistentArrayType | 採用 |  |
| useConsistentArrowReturn | 採用 |  |
| useConsistentBuiltinInstantiation | 採用 |  |
| useConsistentCurlyBraces | 採用 |  |
| useConsistentGraphqlDescriptions | 採用 | GraphQLは使っていない。使い始めたときの一貫性のため有効にしておく |
| useConsistentMemberAccessibility | 採用 |  |
| useConsistentMethodSignatures | 採用 | 型安全。型のメソッドを、引数の型の検査が厳しいプロパティの形にそろえる |
| useConsistentObjectDefinitions | 採用 |  |
| useConsistentTypeDefinitions | 採用 | 型安全と一貫性。オブジェクトの型を`type`にそろえ、同名のinterfaceが黙って合わさるのを防ぐ |
| useConst | 採用 |  |
| useDefaultParameterLast | 採用 |  |
| useDefaultSwitchClause | 採用 | 型安全。`switch`に`default`を書き、ユニオンの網羅は`never`への代入で検査する |
| useDeprecatedReason | 採用 | GraphQLは使っていない。使い始めたときの一貫性のため有効にしておく |
| useDestructuring | 採用 |  |
| useEnumInitializers | 採用 | 一貫性。enumを残す場合も値を明示する(noEnumと衝突しない) |
| useErrorCause | 採用 |  |
| useExplicitLengthCheck | 採用 |  |
| useExponentiationOperator | 採用 |  |
| useExportsLast | 不採用 | 宣言を公開か非公開かで分け、関係する宣言を近くに置けなくなる(`agents/implementation.md`の、利用範囲に最も近い場所に置く配置の方針と逆) |
| useExportType | 採用 | 型安全。`isolatedModules`(tsconfig)の下で、型だけの書き出しを明示する |
| useFilenamingConvention | 採用 | 一貫性。ファイル名の形をそろえる(Next.jsの経路の名前に従う) |
| useForOf | 採用 | 複雑さの抑制。添字を使わないループを`for…of`にする |
| useFragmentSyntax | 採用 | 一貫性。Reactのフラグメントを`<>`にそろえる |
| useGlobalThis | 採用 | 一貫性。ブラウザ、Service Worker、サーバー、テストで動くコードのグローバルの名前を`globalThis`にそろえる |
| useGraphqlNamingConvention | 採用 | GraphQLは使っていない。使い始めたときの一貫性のため有効にしておく |
| useGroupedAccessorPairs | 採用 |  |
| useImportType | 採用 | 型安全。`isolatedModules`(tsconfig)の下で、型だけの読み込みを明示する |
| useInputName | 採用 | GraphQLは使っていない。使い始めたときの一貫性のため有効にしておく |
| useLiteralEnumMembers | 採用 | 一貫性。enumを残す場合も値をリテラルに限る(noEnumと衝突しない) |
| useLoneExecutableDefinition | 採用 | GraphQLは使っていない。使い始めたときの一貫性のため有効にしておく |
| useNamingConvention | 採用 | 一貫性。識別子の名前を`agents/implementation.md`の「識別子の命名」の規約にそろえる(生成されたDBの型は対象外) |
| useNodeAssertStrict | 採用 | 一貫性。Node.jsの`assert`を使う場合の形をそろえる |
| useNodejsImportProtocol | 採用 | 一貫性。Node.jsで動くスクリプトと設定ファイルの組み込みモジュールを`node:`にそろえる |
| useNumberNamespace | 採用 |  |
| useNumericSeparators | 採用 |  |
| useObjectSpread | 採用 |  |
| useReadonlyClassProperties | 採用 | 型安全。変えないクラスのメンバーを`readonly`にする |
| useSelfClosingElements | 採用 |  |
| useShorthandAssign | 採用 |  |
| useShorthandFunctionType | 採用 |  |
| useSingleVarDeclarator | 採用 |  |
| useSpreadOverApply | 採用 |  |
| useSymbolDescription | 採用 |  |
| useTemplate | 採用 |  |
| useThrowNewError | 採用 |  |
| useThrowOnlyError | 採用 | 型安全。投げる値を`Error`に限る |
| useTrimStartEnd | 採用 |  |
| useUnifiedTypeSignatures | 採用 | 複雑さの抑制。まとめられるオーバーロードを1つにする |
