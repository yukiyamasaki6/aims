# Implementation

合意済みの設計に基づいて実装する。

## コードの複雑さ

- 関数の認知的複雑度を15以下にする。Biomeの`noExcessiveCognitiveComplexity`が`pnpm lint`とCIの`Lint`で検査する。
- 15はBiomeとSonarQubeの既定値で、既存コードを責務の分割で収められる値である。
- 超えるときは、責務、判断、段階の単位で分ける。数値を下げるためだけの分割(意味のない小関数、コンポーネント内の描画用の関数への移動、条件を名前に隠すだけの変更)はしない。
- ループで処理しない要素は、先頭で`continue`して飛ばし、入れ子を深くしない。
- 分けると読みにくくなる関数に限り、`// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <理由>`で例外にする。
- テスト以外の関数の長さを50行以下にする。Biomeの`noExcessiveLinesPerFunction`(`skipBlankLines`)が`pnpm lint`とCIの`Lint`で検査する。数え方はBiomeに従い、空行、コメントだけの行、`{`か`}`で始まる行を数えず、内側の関数の行を外側にも数える。
- 50はBiomeとESLint(`max-lines-per-function`)の既定値で、既存コードを責務の分割で収められる値である。
- テストのコード(`biome.json`の`overrides`に挙げたファイル)は長さの対象外とする。テストの長さの大半は`describe`の中身で、ケース数に比例し、処理の追いやすさを表さないためである。認知的複雑度の上限はテストにも掛かる。
- 長さを超えるときの分け方は認知的複雑度と同じである。分けると読みにくくなる関数に限り、`// biome-ignore lint/complexity/noExcessiveLinesPerFunction: <理由>`で例外にする。例外の一覧は`git grep -n "biome-ignore lint/complexity/noExcessiveLinesPerFunction"`で出す。

## 識別子の命名

- 識別子の名前を、種類ごとに次の形にする。Biomeの`useNamingConvention`が`pnpm lint`とCIの`Lint`で検査する。
    - 変数、関数、メソッド: camelCase。Reactの部品と、部品を受ける変数はPascalCaseでよい。
    - 関数の引数: camelCase。部品を受けるときは分割代入で改名する(`({ icon: Icon })`)。
    - 型、インタフェース、クラス、列挙: PascalCase。
    - 定数: モジュールの直下はcamelCase、PascalCase、CONSTANT_CASEのどれでもよい。関数の中(`describe`の中を含む)ではCONSTANT_CASEにしない。
    - 型のプロパティはcamelCaseかsnake_case、オブジェクトリテラルのプロパティはそれに加えてPascalCaseとCONSTANT_CASEも使える。
    - 上にない種類はBiomeの既定に従う。
- 略語は単語として書き、大文字を続けない(`Db`、`Url`、`Id`)。
- 外部が決めた名前(DBの列、RPCの引数、外部サービスのAPIの項目、仕様の項目、環境変数、ライブラリの設定や差し替える部品の名前)は改名しない。
- プロパティでsnake_caseを許すのは、DBの行の形をアプリの型で写している既存の作りのためである。アプリだけで使う名前を新たに決めるときはcamelCaseにする。
- オブジェクトリテラルのプロパティでPascalCaseとCONSTANT_CASEを許すのは、テストの差し替えで部品名やモジュールの定数名を、設定で環境変数名を写すためである。
- 規約の形にならない外部の名前に限り、`// biome-ignore lint/style/useNamingConvention: <理由>`で例外にする。理由には名前を決めた外部を書く。例外の一覧は`git grep -n "biome-ignore lint/style/useNamingConvention"`で出す。
- 生成されたDBの型(`apps/web/src/types/supabase.ts`)は、生成器とDBが名前を決めるため検査の対象外とする(`biome.json`の`overrides`)。

## 書き方の規則

- Biomeのstyleの次の規則は、`pnpm lint`とCIの`Lint`がerrorとして検査し、`pnpm lint:fix`で直らないため手で守る。
    - `noDescendingSpecificity`(CSS): 同じ要素を指す、詳細度の高いセレクタの後に、低いセレクタを書かない。低いセレクタを高いセレクタより前へ移す。
    - `noNonNullAssertion`: `!`で型検査を外さない。値がないときに早期returnか`throw`をする判定で型を絞るか、値が欠けない型にする。
    - `useLiteralEnumMembers`: enumのメンバーの値をリテラル(文字列、数値、他のメンバーの参照)にし、計算した値にしない。
    - `useNodejsImportProtocol`: Node.jsの組み込みモジュールを`node:`付きで読み込む(`fs`ではなく`node:fs`)。
    - `useTemplate`: 文字列の連結を`+`ではなくテンプレートリテラルで書く。
- `pnpm lint:fix`が直す規則(`useConst`、`useImportType`など)は書き方を覚えなくてよい。規則の採否と理由は`docs/lint-rules.md`にある。

## フロントエンド

- `any` は使用しない。
- React Server Componentsをデフォルトとし、`"use client"` は必要な範囲に限定する。
- Tailwind CSSを使用し、既存の `shadcn/ui` コンポーネントを再利用する。
- プロジェクトで使用しているNext.jsバージョンのAPIに従い、非推奨のパターンを使用しない。
- UIの状態変更や副作用を決定するアプリケーション固有の判断は、UIコンポーネントから分離する。UIコンポーネントは、その判断に基づく状態変更や副作用の実行を担う。

### 配置

- 共有コードは利用範囲に最も近い親へ配置し、兄弟ルートの内部実装を参照しない。
- ルート配下の共有は `_shared/`、ルートをまたぐ機能は `features/`、機能非依存の共有は `components/`、`hooks/`、`lib/` に配置する。
- 複数ファイルから参照する定数は `*-constants.ts` に分離し、値のみ記述する。

### 成果物

- フロントエンド実装コード

## データベース

- スキーマ変更はversion管理されたmigrationで行い、ad-hoc SQLを使用しない。
- migrationは `pnpm db:reset` を通して適用する。
- 新規または変更するテーブルにはRLSポリシーを定義する。
- `anon, authenticated` に必要な権限だけを明示的に付与する。アプリが使わない書き込みのポリシーとGRANT、および不要な関数のEXECUTEを残さない。
- スキーマ変更後は `pnpm db:types` で型定義を再生成し、生成結果にログのprefixが含まれる場合は除去する。

### 成果物

- migration
- 再生成された型定義
