# settings 設計

## 概要

設定画面は`/settings`の1画面で、`(main)`配下に置く(認証の保護とセッション喪失の見張りは他の画面と同じ)。
分類は縦に並べた区画で表し、今は「アカウント」と「診断」の2つである。分類ごとのURLと、分類の一覧(タブや側面の一覧)は持たない。
分類「アカウント」に「パスワード変更」の項目(リンク)を置き、専用の画面`/settings/password`(`auth/change-password`)へ移る。項目の画面は、分類ではなく項目ごとのURLを持つ。
サインアウトは認証の部品(`SignOutButton`)を、入口が分類「アカウント」の区画へ渡して置く。
画面の枠(`/__shell/settings`)をオフライン用に保存し、オフラインでもサインアウトできる。
「診断」の区画は、入口が表示領域の診断の部品(`DiagnosticsToggle`)を`diagnostics`の枠へ渡して置く(`app/viewport-diagnostics`)。
レフトパネルは、サインアウトのあった下端に「設定」項目を置く。

## 画面と状態

| 画面・状態 | 内容 |
| :--- | :--- |
| `/settings`(認証済み) | 見出し「設定」と、分類「アカウント」の区画(パスワード変更の項目、サインアウト)と、分類「診断」の区画(表示領域の診断の切り替え)を表示する。 |
| `/settings`(未認証) | `proxy.ts`が遷移元付きで`/signin`へ送る。サインインすると`/settings`へ戻る。 |
| `/settings`(オフライン) | Service Workerが保存済みの枠を返す。未認証の確定は`(main)`の見張りが`/signin`へ移す。 |

## 画面の作り

- 画面は左寄せで、`main`は`mx-auto flex min-h-full max-w-xl flex-col gap-8 p-8`、見出しは`h1`の`text-2xl font-semibold`である(変更しない)。
- 分類の区画は`flex flex-col gap-2`である。
  分類の見出しは`h2`のまま、`text-sm font-medium text-muted-foreground`にして、灰色で小さく表示し、項目より目立たせない。
- 項目は、1つのまとまった枠に見えるように並べる。
  外側の枠(境界線と`overflow-hidden`)は持たない。
  各行が、自分の境界線と角丸を持つ。
  並べる`div`は`flex flex-col`で、子に対して次を当てる。
  先頭の行だけ上の角を、末尾の行だけ下の角を丸める(`[&>*:first-child]:rounded-t-lg`、`[&>*:last-child]:rounded-b-lg`)。
  先頭の行だけ上の境界線を持つ(`[&>*:first-child]:border-t`)。
  間の行は角を丸めず、上の境界線を持たない(行の大きさの種類が持つ)。
  行の間の線は、上の行の下の境界線だけで、隣り合う行の境界線が重なって太くならない。
  行が1つだけのときは、先頭と末尾の両方が当たり、四隅が丸まる。
- 行は、パスワード変更のリンクもサインアウトのボタンも、`variant="ghost"`と新しい大きさ`size="row"`で描く。
  `row`は、`Button`(`src/components/ui/button.tsx`)の大きさの種類に足し、`relative h-10 w-full justify-start rounded-none border-t-0 border-foreground/40 px-3 focus-visible:z-10`とする(高さ40px、幅いっぱい、左寄せ、角丸なし、上の境界線なし、境界線の色、フォーカス中は前面)。
  文字は`Button`の基本の`text-sm font-medium`で、押下の背景は`ghost`の`hover:bg-muted`である。
  リンクは`cn(buttonVariants({ variant: "ghost", size: "row" }))`を`Link`に使う。
  `buttonVariants`だけでは、基本の`rounded-lg`と`size="row"`の`rounded-none`などが文字列に両方残り、勝つ側がCSSの出力順に依る。
  `Button`は`cn`(`twMerge`)を通して、後ろの大きさの指定を残す(`button.tsx`)。リンクも同じ`cn`を通す。
  行の大きさと境界線の色の定義は、`size="row"`の1か所にする。
- 境界線(行の間の線を含む)の色は、`border-foreground/40`である。
  既存の`--border`(`oklch(0.922 0 0)`)は、白の背景に対するコントラストが約1.3:1で、目視でほぼ見えなかった(撮影で確認)。
  `--foreground`(`oklch(0.145 0 0)`)の40%は、白の背景に対して約2.7:1になる(見積もりで、実測ではない)。
  `--ring`や`--muted-foreground`の直接の使用は、意味(フォーカス、補助の文字)が違うため避けた。
  `--foreground`に基づくため、ダークモードを入れて`--foreground`が反転しても、背景に対して同じ向きの濃さになる(今はダークモードがない)。
- フォーカスリングは、`Button`の規約(`focus-visible:ring-3 focus-visible:ring-ring/50`、境界線を`ring`の色にする)のままで、外側に描く。
  外側の枠の`overflow-hidden`を持たないため、リングは切れない。`ring-inset`は使わない。
  フォーカス中の行は`z-10`で前面に出し、隣の行の背景(押下の色)がリングを覆わないようにする。
- 項目が増えたときも、同じ並びの中に行として足す。
- 色と大きさは、既存のトークン(`globals.css`の`--foreground`、`--muted`、`--muted-foreground`)とButtonの規約だけを使い、新しいトークンを足さない。
- 配置と見た目はE2Eで確かめない(`agents/testing.md`)。

## 構成とデータの流れ

- `src/app/(main)/settings/page.tsx`(入口): クライアントのページ。`useSession`で受け取った手続きの`signOut`で`SignOutButton`を作り、`SettingsScreen`の分類「アカウント」の枠へ渡す。分類「診断」の枠へは`DiagnosticsToggle`を渡す。
- `src/components/ui/button.tsx`(共有の画面部品): 大きさの種類に`row`を足す。
- `src/features/settings/ui/settings-screen.tsx`(UI層): 見出しと、分類の区画(見出し付き)と、項目の枠を描く。分類「診断」の内容は入口が渡す`diagnostics`の枠に置く。
  行は、「パスワード変更」のリンクと、入口が渡す`account`(サインアウトの行)を並べる。
  先頭・末尾の角丸は、子の位置を当てる並べる`div`のクラスで付け、行の数が増えても崩れない。
  `account`は、流れの中に行となる要素を1つだけ描く(確認ダイアログはポータルで、流れに要素を足さない)。「パスワード変更」の項目は、経路表の`CHANGE_PASSWORD_PATH`へのリンクとしてここで描く(認証の部品を要さない)。認証の部品(サインアウト)は入口が渡す。認証状態は持たない。
- `src/features/settings/ui/settings-messages.ts`(UI層): 文言の一覧(名前空間`settings`)。
- `src/routes.ts`(経路表): `SETTINGS_PATH`(`/settings`)と、`CHANGE_PASSWORD_PATH`(`/settings/password`)と、全ての画面の枠の一覧`FRAME_PATHS`(ラウンドの4画面と、設定の2画面)を持つ。
- 保護の範囲は、`features/auth/domain/auth-routes.ts`が`ROUNDS_PATH`と`SETTINGS_PATH`とその配下とする。遷移元の許可も同じ範囲である。
- `src/proxy.ts`の`matcher`に`/settings/:path*`を加え、`proxy.test.ts`が経路表との一致を確かめる。
- 枠の保存と配布(`serwist.config.mjs`、`next.config.ts`の`/__shell/*`のrewrite、`sw.ts`の枠の判定)は`app/offline-pwa`に従い、`FRAME_PATHS`から導く。
- 各ファイルの層は`docs/architecture.md`の「1. 構造」に従う。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| 分類ごとのURLを持たず、分類は1画面の区画で表す | 分類が少ない間は不要で、URLを持つと枠の保存対象(`FRAME_PATHS`)と`matcher`が分類の数だけ増えるため。 | 分類が増え、1画面に収まらなくなったとき。URLが要るときは、枠を増やさないクエリ(`?category=`)で表す。 |
| 分類の一覧(タブや側面の一覧)を置かない | 1つの分類を選ぶ操作は利用者に価値がないため。区画の見出しを分類として使い、増やすときは区画を足す。 | 分類が3つ以上になるとき。 |
| サインアウトは、入口が認証の部品を渡して置く | 設定の機能が認証の機能のUIを直接importできないため。レフトパネルに渡していた方式と同じにする。 | 設定の機能が認証の入口(`index.ts`)を介して部品を受け取れるようになったとき。 |
| 行の大きさを`Button`の大きさの種類`row`に置き、リンクもボタンも同じ種類で描く | 設定の機能が認証の部品(`SignOutButton`)のUIを直接importできない(R3)ため、行の大きさと境界線の色を、共有の画面部品の1か所で決める。入口が渡すサインアウトも、同じ`row`で描くだけで、リンクと同じ大きさ・左寄せになる。クラスを両方に複製すると、見た目が別々に変わる | 行に説明文や右端の表示が要るとき |
| 画面の枠の一覧を`ROUND_FRAME_PATHS`から`FRAME_PATHS`へ改め、設定画面を加える | 一覧はラウンドに限らない画面の枠で、名前が内容と食い違うため。詳細のプレースホルダー(`ROUND_FRAME_PATH`、`ROUND_FRAME_ID`)はラウンド固有のため残す。 | 画面の種類ごとに枠の扱いを分けるとき。 |
| 保護の範囲を`ROUNDS_PATH`配下に`SETTINGS_PATH`配下を加えた集合にする | 設定画面は認証が要り、遷移元として戻れる必要があるため。 | 保護する画面の根が増え続けるとき(経路表に保護の根の一覧を持たせる)。 |

## 制約と未対応

- 分類は「アカウント」「診断」の2つで、設定項目はパスワード変更、サインアウト、表示領域の診断の切り替えである。
- 見た目は、本番ビルドの撮影(PC 1280x800、SP 390x844)で確かめた(E2Eでは確かめない)。
  外枠はなく、行ごとの角丸で、先頭の行は上の角、末尾の行は下の角だけが丸い。
  行の間の区切り線は、`border-foreground/40`ではっきり見える。
  フォーカスリングは切れず、行の外側まで全周に見える。
  `z-10`のフォーカス中の行は、隣の行の枠線の上に描かれ、他の行の枠・文字に干渉しない。
  リングは薄い灰色で、白い背景では目立ちが弱い。
- 未確認: ダークモード(今はない)、他のブラウザ、実機。コントラストの数値(約2.7:1)は見積もりである。
- `/settings`の下の画面は、`/settings/password`だけである。他の`/settings/…`は保護されるが、画面はなく404になる。
