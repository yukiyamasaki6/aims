# Implementation

合意済みの設計に基づいて実装する。

## コードの複雑さ

- 関数の認知的複雑度を15以下にする。Biomeの`noExcessiveCognitiveComplexity`が`pnpm lint`とCIの`Lint`で検査する。
- 15はBiomeとSonarQubeの既定値で、既存コードを責務の分割で収められる値である。
- 超えるときは、責務、判断、段階の単位で分ける。数値を下げるためだけの分割(意味のない小関数、コンポーネント内の描画用の関数への移動、条件を名前に隠すだけの変更)はしない。
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

## 構造の部品の命名

- 構造の部品の名前を、次の表の形にする。1つの規則を機能ごとに別の形で書かない。

| 概念 | 規則 |
| --- | --- |
| 経路のファイル | `domain/<機能の単数形の概念>-routes.ts`(1機能に1つ以下)。経路の値は`<名前>_PATH`、経路を作る関数は`<名前>Path`、経路の集合は`<名前>_PATHS`、経路の部品(ID・接頭・パラメーター名)は`<名前>_ID`、`_PREFIX`、`_PARAM`。経路を判定・変換する関数は、判定は`is…`、変換は`<対象>Of`、`<対象>For`、`<対象>Href`など、問いや変換を表す名前 |
| 手続き | ファイル名は型名のkebab-case(1ファイル1手続き)。生成関数は`create<型名>`。型名は`<対象><動作の名詞形>`(`RoundDeletion`)、対象を持たない操作名(`SignIn`、`Start`)、役割の名詞(`Session`、`OpSender`、`ContentFetcher`)のどれか。動詞で始まる型名は、手続きの型名には置かない。手続きの結果を表す型を新設するときは、手続きの型名を接頭にする(`RoundStartResult`)。約束の型、見え方の型、ドメインの型は、この規則の対象外とする。例外は、1つの型の手続きを画面ごとに作る生成関数(`createSignUp`、`createResetPassword`は`PasswordSetup`を返す)で、画面の操作名で呼び、ファイルも画面の操作名とする |
| 窓口 | 型`<画面>Store`、ファイル`<画面>-store.ts`、生成関数`create<画面>Store`(`RoundsListStore`ほか) |
| 手続きの約束 | 頼むこと、読み出す対象を表す名詞(`Clock`、`PageNavigation`、`SignInCheck`、`UniqueIds`)。独立のファイルのときはkebab-case。使い手が1つの約束は、その手続きのファイルに置く。複数の型を持つ約束のファイルは、主な型の名前にする |
| 手続きの依存の引数名 | 約束の型名の先頭を小文字にした名前(`pageNavigation`、`returnToReader`)。役割が分かる短い名前(`hub`、`ids`、`signIn`、`authenticator`、`clock`、`host`)でもよい。同じ型を複数受けるときは役割で区別する |
| 約束の実装 | ファイルは`<技術または相手の機能>-<主題>.ts`。その機能だけが使う実装と、技術が1つに決まる実装は`<主題>.ts`でもよい。生成関数は`create<技術または相手の機能><主題>`(接頭を省いたファイルは`create<主題>`)。主題は、満たす約束の名前の語幹か、約束が表す能力の名前(約束が複数なら主な概念)で、単複、語順、略語の綴り(`IndexedDb`と`indexeddb`)は問わない。判定は、ファイル名のハイフンを除いて小文字にした文字列(語尾の`s`の有無は問わない)が、生成関数名から`create`を除いて小文字にした文字列に含まれること(生成関数が複数ならいずれかが満たせばよい)。例は`browser-clock.ts`と`createBrowserClock`、`router-page-navigation.ts`、`auth-sign-in-check.ts`。1つの実装が複数の約束を満たすときは主な約束の名前(`createBrowserPageLoad`は`PageLoad`と`PageReplace`)。対象外は、約束を満たさない構成部品(Serwistのキャッシュ戦略、定数、生成された型)で、約束を持たない外部の接続の生成関数(`createClient`、`createServerClient`、`createAdminClient`)は接続の名前でよい |
| 他の機能の入口を包む約束 | 下の表のとおり |
| 文言の一覧 | 機能はUI層の`ui/<機能>-messages.ts`の`<機能>Messages`(camelCase)、共有の画面部品は`components/screen-messages.ts`の`screenMessages`。値は`{ ja: { <キー>: <本文> } }`。キーはcamelCaseで、機能の中で一意にする。結果の種類の文言は種類の名前を、画面の部品の文言は部品の名前を接頭にする |
| 型だけ・定数だけのファイル | `-types`、`-constants`は、型だけ、定数だけのファイルに限る。関数を持つファイルには付けず、概念の名前にする |
| テスト補助 | `agents/testing.md`の「テスト補助の置き場」 |

### サインイン状態を読む約束

- サインイン状態を読む約束は統一せず、次の表のとおり並存させる。変換する中身(文言、経路)が違い、1つにすると片方が使わないメンバーを持つため。
- 他の機能の入口を包む手続きの約束は、自機能での用途の名前にする(`SignInCheck`)。包むインフラ層の実装は、ファイル名`<相手の機能>-<約束名>.ts`、生成関数`create<相手の機能><約束名>`にする(`auth-sign-in-check.ts`と`createAuthSignInCheck`)。型だけで足りるときは、自分の約束を置かない(`SessionReader`、`IdentityReader`)。

| 型 | 持ち主 | 形 | 使い手 | 並存の理由 |
| --- | --- | --- | --- | --- |
| `SessionReader` | 認証(入口が型を公開) | `readSession(options?)`が`{status, userId?}`を返す | 同期の手続き(`round-sync.ts`)と、ラウンドの取得、開始、プリセットの手続きが、型だけで直接受ける | 形を変えずに使える |
| `IdentityReader` | 認証(入口が型を公開) | `read()`が端末に記録された最後の利用者を返す(同期、通信なし) | `sync-triggers.ts`(型だけ)、`reference-snapshot.ts`(インフラ層) | サインインの状態ではなく、端末の記録の読み出しで、別の概念 |
| `SignInCheck` | ナビゲーション(手続きの約束) | `readStatus()`と、サインアップの経路、サインインの後の既定の行き先 | 開始の手続き | 認証の経路の関数・定数(`SIGN_UP_PATH`、`destinationOf`)とラウンドの定数を、ナビゲーションの言葉に変える。手続きは他の機能の関数を参照できない |

## フロントエンド

- `any` は使用しない。
- React Server Componentsをデフォルトとし、`"use client"` は必要な範囲に限定する。
- Tailwind CSSを使用し、既存の `shadcn/ui` コンポーネントを再利用する。
- プロジェクトで使用しているNext.jsバージョンのAPIに従い、非推奨のパターンを使用しない。
- UIの状態変更や副作用を決定するアプリケーション固有の判断は、UIコンポーネントから分離する。UIコンポーネントは、その判断に基づく状態変更や副作用の実行を担う。

### 配置

- `docs/architecture.md`の置き場所に従う。機能は`features/<機能>/`、機能に属さない共有は、画面部品が`components/`と`hooks/`、技術が`lib/<能力>/`に置く(第2節)。
- 共有コードは使う機能が複数のものだけを共有に置き、兄弟の機能の内部実装を参照しない。
- 定数だけのファイルにするときは `*-constants.ts` とする。部品の付属の値は部品のファイルに、経路は `*-routes.ts` に置く(`docs/architecture.md` の R02)。

### 文言

- 利用者に届く文字列(画面の文言、`aria-label`・`placeholder`・`title`・`alt`などの属性値、`metadata`・`manifest`の文字列、利用者に示すエラーと検証の文言)は、言語を問わず直書きしない。コメント、ログ、開発者向けの例外、識別子、テストのデータ、`lang`などの技術的な設定値は対象外とする。開発者向けの例外でも、利用者に示される経路にあるものは対象とする。
- 文言の解決には`next-intl`を使う。ルーティング(URLのロケール)とミドルウェアは使わない。
- 文言を足す手順は1通りである。その機能のUI層の文言の一覧(共有の画面部品は`components/screen-messages.ts`)にキーと本文を足し、UI層の部品から`useTranslations("<名前空間>")`(サーバーの非同期の部品は`getTranslations`)のキーで参照する。業務の結果の文言は、ドメイン層の部品が結果の種類を返し、一覧が種類ごとに本文を持つ。ドメイン層とアプリケーション層には、文言もキーも書かない。新しい一覧は`src/i18n/messages.ts`に名前空間として登録する。
- 一覧はTypeScriptで書き(JSONにしない)、種類ごとの文言には、種類の型に対する`satisfies`を付ける。本文はICUの書式で、差し込みは`{名前}`、`'`と`{`は書式の規則でエスケープする。
- 存在しないキーと名前空間は、`next-intl`の`AppConfig`に登録した型により、型の検査(`pnpm typecheck`)で失敗する。実行時に見つからないとき、書式に失敗したときは、`src/i18n/messages.ts`の設定が空の文字列を返し、キーを利用者に出さない。開発時は`console.error`で知らせ、テストでは例外にする。
- `metadata`と`manifest`は、`src/i18n/messages.ts`の設定から`createTranslator`で解決する。
- `pnpm lint`の文言の検査(`apps/web/scripts/check-hardcoded-text.mjs`)が、テストと生成物と文言の一覧を除く`apps/web/src`の直書きを検出する。検出の対象は、JSXのテキスト、利用者に届く属性(`aria-label`、`aria-description`、`aria-placeholder`、`aria-roledescription`、`aria-valuetext`、`placeholder`、`title`、`alt`、`label`と、名前が`Label`・`Title`・`Text`・`Message`・`Description`・`Placeholder`で終わる属性)の文字列、利用者に届く名前のプロパティ(`label`、`title`、`description`、`message`、`placeholder`、`alt`、`name`、`short_name`)の文字列、非ASCIIの文字を含む全ての文字列である。`console.*`と例外の生成(`new Error`など)の引数は対象外とする。
- D1とD2の境界の例外は、`apps/web/scripts/hardcoded-text-exceptions.json`に、ファイルと文字列と理由を書く。どの直書きにも当たらない例外の行があると、検査は失敗する。
- `pnpm lint`の未使用キーの検査(`apps/web/scripts/check-unused-message-keys.mjs`)が、文言の一覧のうち本番のコードから参照されないキーを、キーの完全な経路で報告して失敗する。
- 検査の対象のキーは、`src/i18n/messages.ts`の`AppConfig`に登録した`Messages`の型から求める。一覧を名前空間として登録すれば、検査の設定は要らない。
- 参照として数えるのは、テストのファイルと、テストからだけ参照される補助のファイルを除く`apps/web/src`の、`useTranslations`・`getTranslations`・`createTranslator`で得た翻訳関数の呼び出しである。テストからだけ参照されるキーは未使用とする。
- キーの引数は、型で取り得る文字列の集合に展開する。種類の値を差し込む``t(`failure.${kind}`)``は、種類の型の値ごとのキーを参照する。種類の型を`string`に広げると展開できない。
- 翻訳関数は、別名(`const lookup = t as ...`)と、`ReturnType<typeof useTranslations<"<名前空間>">>`の型の引数への受け渡しだけを追う。それ以外の使い方と、展開できないキーの引数は、解釈できない参照として位置を報告して失敗する。
- 解釈できない参照を残すときは、`apps/web/scripts/unused-message-keys-exceptions.json`に、ファイルと、その参照が使うキーの経路(末尾の`.*`で配下全体)と、理由を書く。どの解釈できない参照にも当たらない例外の行、どのキーにも当たらない経路、理由のない行があると、検査は失敗する。

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
