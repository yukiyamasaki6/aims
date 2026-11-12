# settings 設計

## 概要

設定画面は`/settings`の1画面で、`(main)`配下に置く(認証の保護とセッション喪失の見張りは他の画面と同じ)。
分類は縦に並べた区画で表し、今は「アカウント」の1つだけである。分類ごとのURLと、分類の一覧(タブや側面の一覧)は持たない。
サインアウトは認証の部品(`SignOutButton`)を、入口が分類「アカウント」の区画へ渡して置く。
画面の枠(`/__shell/settings`)をオフライン用に保存し、オフラインでもサインアウトできる。
レフトパネルは、サインアウトのあった下端に「設定」項目を置く。

## 画面と状態

| 画面・状態 | 内容 |
| :--- | :--- |
| `/settings`(認証済み) | 見出し「設定」と、分類「アカウント」の区画(サインアウト)を表示する。 |
| `/settings`(未認証) | `proxy.ts`が遷移元付きで`/signin`へ送る。サインインすると`/settings`へ戻る。 |
| `/settings`(オフライン) | Service Workerが保存済みの枠を返す。未認証の確定は`(main)`の見張りが`/signin`へ移す。 |

## 構成とデータの流れ

- `src/app/(main)/settings/page.tsx`(入口): クライアントのページ。`useSession`で受け取った手続きの`signOut`で`SignOutButton`を作り、`SettingsScreen`の分類「アカウント」の枠へ渡す。
- `src/features/settings/ui/settings-screen.tsx`(UI層): 見出しと、分類の区画(見出し付き)を描く。分類ごとの内容は入口が渡す。認証状態は持たない。
- `src/features/settings/ui/settings-messages.ts`(UI層): 文言の一覧(名前空間`settings`)。
- `src/routes.ts`(経路表): `SETTINGS_PATH`(`/settings`)と、全ての画面の枠の一覧`FRAME_PATHS`(ラウンドの4画面と`SETTINGS_PATH`)を持つ。
- 保護の範囲は、`features/auth/domain/auth-routes.ts`が`ROUNDS_PATH`と`SETTINGS_PATH`とその配下とする。遷移元の許可も同じ範囲である。
- `src/proxy.ts`の`matcher`に`/settings/:path*`を加え、`proxy.test.ts`が経路表との一致を確かめる。
- 枠の保存と配布(`serwist.config.mjs`、`next.config.ts`の`/__shell/*`のrewrite、`sw.ts`の枠の判定)は`app/offline-pwa`に従い、`FRAME_PATHS`から導く。
- 各ファイルの層は`docs/architecture.md`の「1. 構造」に従う。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| 分類ごとのURLを持たず、分類は1画面の区画で表す | 分類が1つの間は不要で、URLを持つと枠の保存対象(`FRAME_PATHS`)と`matcher`が分類の数だけ増えるため。 | 分類が増え、1画面に収まらなくなったとき。URLが要るときは、枠を増やさないクエリ(`?category=`)で表す。 |
| 分類の一覧(タブや側面の一覧)を置かない | 1つの分類を選ぶ操作は利用者に価値がないため。区画の見出しを分類として使い、増やすときは区画を足す。 | 分類が3つ以上になるとき。 |
| サインアウトは、入口が認証の部品を渡して置く | 設定の機能が認証の機能のUIを直接importできないため。レフトパネルに渡していた方式と同じにする。 | 設定の機能が認証の入口(`index.ts`)を介して部品を受け取れるようになったとき。 |
| 画面の枠の一覧を`ROUND_FRAME_PATHS`から`FRAME_PATHS`へ改め、設定画面を加える | 一覧はラウンドに限らない画面の枠で、名前が内容と食い違うため。詳細のプレースホルダー(`ROUND_FRAME_PATH`、`ROUND_FRAME_ID`)はラウンド固有のため残す。 | 画面の種類ごとに枠の扱いを分けるとき。 |
| 保護の範囲を`ROUNDS_PATH`配下に`SETTINGS_PATH`配下を加えた集合にする | 設定画面は認証が要り、遷移元として戻れる必要があるため。 | 保護する画面の根が増え続けるとき(経路表に保護の根の一覧を持たせる)。 |

## 制約と未対応

- 分類は「アカウント」の1つだけである。
- 設定項目は、サインアウトだけを持つ。
- `/settings`の下に画面はない。`/settings/…`は保護されるが、画面はなく404になる。
