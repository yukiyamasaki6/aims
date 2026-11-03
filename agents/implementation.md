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
| 経路のファイル | `domain/<機能の単数形の概念>-routes.ts`(1機能に1つ以下)。定数は`<名前>_PATH`、関数は`<名前>Path` |
| 手続き | ファイル名は型名のkebab-case(1ファイル1手続き)。生成関数は`create<型名>`。型名は`<対象><動作の名詞形>`(`RoundDeletion`)、対象を持たない操作名(`SignIn`、`Start`)、役割の名詞(`Session`、`OpSender`、`ContentFetcher`)のどれか。動詞で始まる型名は置かない。付属の型は手続きの型名を接頭にする(`RoundStartResult`)。例外は、1つの型の手続きを画面ごとに作る生成関数(`createSignUp`、`createResetPassword`は`PasswordSetup`を返す)で、画面の操作名で呼び、ファイルも画面の操作名とする |
| 窓口 | 型`<画面>Store`、ファイル`<画面>-store.ts`、生成関数`create<画面>Store`(`RoundsListStore`ほか) |
| 手続きの約束 | 頼むこと、読み出す対象を表す名詞(`Clock`、`PageNavigation`、`SignInReader`、`UniqueIds`)。独立のファイルのときはkebab-case。使い手が1つの約束は、その手続きのファイルに置く |
| 手続きの依存の引数名 | 約束の型名の先頭を小文字にした名前(`pageNavigation`、`returnToReader`) |
| 約束の実装 | ファイル`<技術または相手の機能>-<約束名>.ts`、生成関数`create<技術または相手><約束名>`(`browser-clock.ts`と`createBrowserClock`、`router-page-navigation.ts`、`auth-sign-in-reader.ts`)。1つの実装が複数の約束を満たすときは主な約束の名前(`createBrowserPageLoad`は`PageLoad`と`PageReplace`) |
| 他の機能の入口を包む約束 | 下の表のとおり |
| 型だけ・定数だけのファイル | `-types`、`-constants`は、型だけ、定数だけのファイルに限る。関数を持つファイルには付けず、概念の名前にする |
| テスト補助 | `agents/testing.md`の「テスト補助の置き場」 |

### サインイン状態を読む約束

- サインイン状態を読む約束は統一せず、次の表のとおり並存させる。変換する中身(文言、経路)が違い、1つにすると片方が使わないメンバーを持つため。
- 他の機能の入口を包む手続きの約束は、自機能での用途の名前にする(`SignInReader`、`SignInCheck`)。包むインフラ層の実装は、ファイル名`<相手の機能>-<約束名>.ts`、生成関数`create<相手の機能><約束名>`にする(`auth-sign-in-reader.ts`と`createAuthSignInReader`)。型だけで足りるときは、自分の約束を置かない(`SessionReader`、`IdentityReader`)。

| 型 | 持ち主 | 形 | 使い手 | 並存の理由 |
| --- | --- | --- | --- | --- |
| `SessionReader` | 認証(入口が型を公開) | `readSession(options?)`が`{status, userId?}`を返す | 同期の手続き(`round-sync.ts`、`op-sender.ts`)が型だけで直接受ける | 形を変えずに使える |
| `IdentityReader` | 認証(入口が型を公開) | `read()`が端末に記録された最後の利用者を返す(同期、通信なし) | `sync-triggers.ts`(型だけ)、`reference-snapshot.ts`(インフラ層) | サインインの状態ではなく、端末の記録の読み出しで、別の概念 |
| `SignInReader` | ラウンド(手続きの約束) | `read(options?)`が、未認証と不明に利用者向けの文言を足した形を返す | 取得、開始、プリセットの手続き | 認証の文言(`unconfirmedMessage`、ドメインの関数)を使う変換があり、手続きは他の機能の関数を参照できない |
| `SignInCheck` | ナビゲーション(手続きの約束) | `readStatus()`と、サインアップの経路、サインインの後の既定の行き先 | 開始の手続き | 認証の経路の関数・定数(`SIGN_UP_PATH`、`destinationOf`)とラウンドの定数を、ナビゲーションの言葉に変える。同上 |

## フロントエンド

- `any` は使用しない。
- React Server Componentsをデフォルトとし、`"use client"` は必要な範囲に限定する。
- Tailwind CSSを使用し、既存の `shadcn/ui` コンポーネントを再利用する。
- プロジェクトで使用しているNext.jsバージョンのAPIに従い、非推奨のパターンを使用しない。
- UIの状態変更や副作用を決定するアプリケーション固有の判断は、UIコンポーネントから分離する。UIコンポーネントは、その判断に基づく状態変更や副作用の実行を担う。

### 配置

- 方針を適用した領域(適用の設計が挙げた領域)は、`docs/architecture.md`の置き場所に従う。
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
