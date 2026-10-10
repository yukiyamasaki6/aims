# Implementation

合意済みの設計に基づいて実装する。

## コードの複雑さ

- 関数の認知的複雑度を15以下にする。Biomeの`noExcessiveCognitiveComplexity`が`pnpm lint`とCIの`Lint`で検査する。
- 15はBiomeとSonarQubeの既定値で、既存コードを責務の分割で収められる値である。
- 超えるときは、責務、判断、段階の単位で分ける。数値を下げるためだけの分割(意味のない小関数、コンポーネント内の描画用の関数への移動、条件を名前に隠すだけの変更)はしない。
- 分けると読みにくくなる関数に限り、`// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <理由>`で例外にする。

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
