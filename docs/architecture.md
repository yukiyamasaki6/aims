# アーキテクチャ方針

アプリの全ての機能に適用する構造の規則。依存を内向きに保ち、domainを純粋に保ち、基盤SDKを外側に閉じ込める。
第1〜4節のパスは`apps/web/src/`からの相対で、その構造の規則はテスト(`*.test.*`、`*.spec.*`、`*-test-helpers.*`)を対象外とする。

## 1. 構造

| 区分 | 置き場 | 役割 |
| --- | --- | --- |
| domain | `features/<機能>/domain/` | 業務の規則と型。純粋なTypeScript |
| application | `features/<機能>/application/` | 操作の手続きと、外側へ頼むことの約束(型だけ) |
| ui | `features/<機能>/ui/` | 画面の部品 |
| infrastructure | `features/<機能>/infrastructure/` | 約束の実装、外部へのアクセス |
| 機能の入口 | `features/<機能>/index.ts` | 他の機能へ公開する型の再公開。公開する名前がある機能だけが持つ |
| 共有の技術 | `lib/<能力>/contract/`、`lib/<能力>/infrastructure/` | 複数の機能が使う、業務の言葉を持たない約束と実装 |
| 共有の画面部品 | `components/`、`hooks/`、`lib/utils.ts` | 業務の言葉を持たない画面の部品 |
| 経路表 | `routes.ts` | 経路の定数と作る関数。何も参照しない |
| 入口 | `app/`、`proxy.ts`、`i18n/` | 具体実装と手続きを生成して渡す。業務の判断は持たない |

機能は、利用者が1つの名前で呼べる能力で切る。機能の中は、層のディレクトリと機能の入口だけにする。使わない層は置かない。

## 2. 規則

1. R1 domainは、同じ機能のdomainと経路表と生成型(型だけ)をimportし、`window`、`document`、`localStorage`、`fetch`、`process`、`crypto`などの環境のグローバルを参照しない。
2. R2 基盤SDK(`@supabase/*`、`idb`、`serwist`、`@serwist/*`、`next/server`、`next/headers`)をimportしてよいのは、`infrastructure/`と入口だけ。`react`、`next/link`、`next-intl`などの画面のパッケージはSDKではない。
3. R3 依存の向きは次の表だけで、表にない向きは禁止する。`ui`と`infrastructure`は互いにimportしない。機能の外から機能へは`@/features/<機能>`(機能の入口)だけをimportする。
4. R4 importの循環を禁止する。機能の間の依存は一方向にする。
5. R5 DBの表・RPCの型は生成型(`types/supabase.ts`)から`Pick`/`Omit`で導き、同じ列を持つ型を手書きしない。domainは生成型を`import type`でだけ読んでよい。

| 依存元 | importしてよい先 |
| --- | --- |
| domain | 同じ機能のdomain、経路表、生成型(`import type`だけ) |
| application | 同じ機能のdomain・application、`lib/*/contract`、他の機能の入口(型だけ)、経路表 |
| ui | 同じ機能のdomain・application・ui、共有の画面部品、経路表、画面のパッケージ |
| infrastructure | 同じ機能のdomain・application・infrastructure、`lib/*/contract`、他の機能の入口、生成型、SDK |
| `lib/*/contract` | 同じ種類の`lib/*/contract` |
| `lib/*/infrastructure` | `lib/*/contract`、同じ能力の`lib/*/infrastructure`、生成型、SDK |
| 共有の画面部品 | 共有の画面部品、経路表、画面のパッケージ |
| 入口 | 全て(`lib/*/infrastructure`をimportしてよいのは入口だけ) |

- 参照の書き方: 機能の中は相対パス、機能の外から機能へは`@/features/<機能>`、入口から機能の中へは層までのパス。
- uiは、画面の動きに合わせる`window`、`document`、`setTimeout`を使ってよい。

## 3. 検査

- R1〜R4は`biome.json`の`overrides`が止める。`pnpm lint`が実行する。例外は、設定のパス除外か、コード側のコメント1行で示す。
- レビューで確かめるのは、R5と、他の機能の入口を型だけでimportすることの2点(biomeは「型だけ」のimportを区別できないため、domainが生成型を値でimportしないこともここで確かめる)。
- 規則を足すのは、崩れたときの害が非局所か不可逆で、近く起きる見込みが高く、守る費用が設定数行かレビュー1項目に収まるときだけ。サーバー専用のコード(`service_role`、管理者API、`next/headers`)を初めて置くPRでは、`server-only`の規則を足す。

## 4. 画面部品の既定

- 開いた直後のフォーカスは、入力欄でなく、開いたもの(ダイアログのポップアップ、パネルの領域)へ置く。スマホでキーボードが勝手に開くのを避けるため。
- 既定は共通のダイアログ部品(`components/ui/dialog.tsx`)が持ち、個別の画面は上書きしない。入力欄でない先頭の操作へ移す例外は、`DialogContent`の`focusTarget`で明示する。詳細と検査は`features/app/open-focus/`に従う。

## 5. テストの状態と資源の境界

既存のVitest・Playwright・pgTAPで主要利用経路を検証する。
E2Eは本番ビルドを含むpreviewを使い、実行ごとに新しいビルドとサーバーを用意する。
以下のパスは`apps/web/`からの相対とする。

### 後始末

履歴のUIテストは`cleanup()`でReactをアンマウントし、effectの後始末を終えてからviewport・検索条件・モック・時計・グローバルを復元する。
`src/lib/viewport/fake-viewport-test-helpers.ts`はテストごとのブラウザ状態を提供し、復元の順序は呼出側が管理する。
準備途中に失敗した場合も、作成済みの資源を解放する。

### 状態を特定した待機

ハイドレーション、Service Workerの制御、対象データの取得、端末への保存、サーバーへの反映を別の境界として確認する。
オフラインへ切り替える前に、Service Workerの準備後の対象詳細・必要なベース・操作可能な表示を確認する。
点数入力は矢・距離・値に一致する送信の成功または保存状態を確認し、関係しない先行RPCの応答で再読み込みへ進まない。
時間中に変化しないこと、OTP再送間隔、オフライン・再接続・複数端末・認証切替の成立条件を保つ。

### ブラウザ履歴の観測

設定経路の単体テストは実際のjsdomのHistory・Locationを使い、履歴への追加を、実処理へ委譲する`pushState`の呼出しとURL・状態の内容で確認する。
`replaceState`による準備は進む履歴を消さないため、追加の検証を履歴の総数の増分に依存させない。
戻る・進む・閉じる先の検証は実際の履歴移動と表示・起点の状態で行い、非同期の移動完了を確認してから次へ進む。
履歴APIの監視は対象操作の直前に設置し、テスト後に復元する。

### データ準備の認証

`tests/e2e/helpers/round-fixtures.ts`はケース内で認証済みクライアントを所有し、`helpers/rounds.ts`の作成処理と`helpers/other-device.ts`の完了処理へ渡す。
メールアドレスを受ける準備入口と認証済みクライアントを受ける入口はRPCの処理を共有する。パスワードを使う準備入口はOTP認証へ置換する。
準備用クライアントはケース・ブラウザ・他端末をまたいで共有せず、後始末でタイマー等を止める。
一覧の状態や認証変更を扱うケースは固有ユーザーを使い、認証・失効・複数端末そのものの検証では実際の認証経路を通す。

### ブラウザ準備と通信介入

サインインの画面操作を検証しないケースは、固有ユーザーの認証を実SDKの標準OTPとローカルメール取得で行い、`@supabase/ssr`のCookieアダプターを通して新しいBrowserContextにセッションを用意する。
`tests/e2e/helpers/auth.ts`がセッションの準備を担い、`helpers/round-fixtures.ts`が必要なケースだけに利用者とメールアドレスを渡す。
セッションの準備は、端末の利用者の記憶も準備した利用者にする。
記憶が空か別の利用者のままだと、アプリが利用者の切り替えとして最初の画面を読み込み直し、テストの操作と競合するためである。
記憶は準備の後に最初に読み込む文書で1回だけ書き、後の準備が前の記憶を置き換え、アプリがサインアウトで消した記憶は戻さない。
端末の保存(`localStorage`)の消去は、共有の認証状態を引き継ぐケースごとの利用者の用意(`tests/e2e/fixtures.ts`)だけが指定し、記憶を最初に書く直前に1回行う。
保存の消去と記憶の書き込みは、初期化スクリプトの実行順に依存させない。
既存のUI経由の認証補助は維持し、認証・切替・失効・OTPやサインイン後の遷移を検証するケースでは画面操作を通す。
準備用と検証する別端末のセッションを使い回さず、Cookieの形式・分割はSDKへ任せ、ブラウザと同じ認証先・Cookie名・アプリのoriginに揃える。
`tests/e2e/fixtures.ts`はTurnstileのモックを既定で維持し、認証画面へ到達しないと明示したケースにだけrouteを登録しない選択を提供する。
URLが一致しないrouteもHTTPキャッシュを無効にするため、通信介入は検証に必要な範囲に限定する。
Service Worker・端末保存・複数端末・通信失敗の介入はそれぞれの検証で維持し、認証モックの省略と混同しない。
