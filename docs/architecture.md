# アーキテクチャ方針

アプリの全ての機能に適用する構造の規則。依存を内向きに保ち、domainを純粋に保ち、基盤SDKを外側に閉じ込める。
パスは`apps/web/src/`からの相対。テスト(`*.test.*`、`*.spec.*`、`*-test-helpers.*`)は対象外。

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
