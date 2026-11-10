# rounds/history 設計

## 概要

`/rounds`で、ユーザーが属するラウンドを一覧する。
一覧は、入力中のラウンドを先頭の見出し付きの領域にまとめ、その下に入力中でないラウンドを実施日の新しい順に並べる。
入力中のラウンドは、端末が知る状態(取得したベースに未送信の操作を重ねた状態)から、詳細と同じ導出と表示の規則(`isRoundInProgress`)で決める。保持の規則(`rounds/sync`)は使わない。
取得できないときも入力中の領域を出し、その下にだけ取得中・オフライン・エラーを出す。
各カードに名前・実施日・合計点を出し、カードから`/rounds/[id]`へ、右下の新規作成ボタンから`/rounds/new`へ遷移する。
一覧は読み取り中心の画面で、書き込みはカードのメニューからの削除だけである。
削除は`rounds/delete`が扱う。
取得はクライアントで行い、枠（見出し、新規作成ボタン）は静的である。

## 画面と状態

| 状態 | 入力中の領域 | その下(入力中でないラウンドの部分) |
| :--- | :--- | :--- |
| 取得の成功 | 入力中のラウンドが1件以上あれば、見出し「入力中」とカード | 入力中の領域を出すときは見出し「過去履歴」とカード(0件なら節ごと出さない)。出さないときは見出しなしのカード、0件なら「まだラウンドがありません。」 |
| オフライン(`navigator.onLine`が`false`) | 端末から導いた入力中のラウンド | 入力中の領域を出すときは見出し「過去履歴」の下に「ネットワークに接続されていません」と再試行ボタン。出さないときは見出しなしで同じ表示(`app/offline-pwa`) |
| 取得中 | 取得を待たず、端末の読み込み直後から、端末から導いた入力中のラウンド | スケルトン。入力中の領域を出すときは見出し「過去履歴」の下 |
| エラー | 端末から導いた入力中のラウンド | 入力中の領域を出すときは見出し「過去履歴」の下にエラーメッセージと再試行ボタン。通信失敗は「読み込めませんでした。」。未認証は「サインインが必要です。」 |

- 領域は節(`flex flex-col gap-2`)で、見出し「入力中」(`h2`、`text-sm font-medium`)の下にカードを並べる。入力中のラウンドが無いときは、見出しごと出さない。カードに「入力中」の印は付けず、端末から導いたカードと取得したカードを見た目で区別しない。
- 下の部分の見出し「過去履歴」は、入力中の領域を出しているときだけ付ける。取得が成功し、入力中でないラウンドが0件のときは、節を見出しごと出さない。オフライン・エラーの表示は、この節の残りの領域の中央に置く。
- 入力中の領域は常に端末の値で出し、取得は裏で行う。取得が完了すると、その下のスケルトンが取得したカードに置き換わる。入力中のカードの内容は取得の前後で変わらない。他端末が完了にしたラウンドは、端末の記録が同期で更新された後に入力中の領域から外れ、下の部分に出る。
- 再試行ボタンを押すと、その下がスケルトンになる。入力中の領域は出したままにする。
- 入力中のラウンドのカードも、既存のメニューと確認で削除でき、その場で消える。最後の1件を消すと、領域は見出しごと消える。
- 新規作成ボタンは、全状態で常に表示する。
- 未認証のアクセスは`proxy.ts`が`/signin`へ送る。この挙動は一覧の要求に含めない。

## 構成とデータの流れ

パスは、断りがなければ`apps/web/src/`からの相対である。

- `app/(main)/rounds/page.tsx`（Client Component、入口）: 枠（見出し）を描画し、`RoundsList`を描く。何も生成せず、取得もせず、`cookies()`も読まない。
- `features/rounds/ui/rounds-list.tsx`（UI層、Client Component）: `RoundsListStore`の`loadList`の結果から`roundsListView`が決めた内容に応じて、領域・カード・削除メニュー、または取得中・オフライン・エラーの表示を描画する。新規作成ボタンは全状態で描画する。カードと新規作成ボタンの行き先は`roundPath`、`NEW_ROUND_PATH`である。自分の削除は手続きの入れ物の`deletion.deleteRound`で行い、この画面の削除済みの集合へ足して除き、取得の状態が変わっても失わない。読み込みの全体を`withinFetchTimeout`で10秒に打ち切る(`app/offline-pwa`)。
- `features/rounds/ui/use-local-rounds-list.ts`（UI層）: 表示の開始時に`RoundsListStore.loadLocalList`を読み、端末の記録が変わるたびに(`RoundsListStore.subscribe`)読み直す。一括の取得の反映も届く。読み終えるまでは`null`を返す。
- `features/rounds/ui/use-fetch-result.ts`、`fetch-state.tsx`（UI層）: 画面の取得の状態と再取得、取得の状態の表示。オフラインの間は、画面が渡す`whenOnline`(一覧は手続きの入れ物の`whenOnline`)で通信の復帰を受ける。
- `features/rounds/domain/rounds-list-view.ts`（domain）: 取得結果を、入力中の領域とそれ以外の並びに分ける(`overlayRoundsList`)。それ以外 = 取得 − 入力中の領域のID − 削除済みで、値は取得の値のまま(完了で未送信の変更が残るラウンドを端末の値で出さない)。入力中の領域は実施日の新しい順に並べ、それ以外は取得の順のまま(サーバーが実施日の新しい順で返す)にする。同じ実施日の並びは定めない。`roundsListView`は、取得の状態と端末の入力中のラウンドから、画面に出す内容を決める純粋関数である。入力中の領域は端末の入力中のラウンドだけで決め、取得の値を混ぜない。端末の入力中を読み終えるまでは、取得が成功していても取得中として返す。
- `features/rounds/domain/round-list.ts`（domain）: 一覧の材料の型(`LoadedRoundsList`、`LocalRoundsList`、`ServerRoundSummary`)と、削除済みと入力中と合計点の導出を持つ。`ServerRoundSummary`は取得した行と同形(列名`round_date`、`disabled_at`のまま。生成型から導く)で、画面の名前への写しは`roundListItemOf`の1か所である。端末の記録だけから求める入力中のラウンド(`LocalRoundsList`)は削除済みを入れず、削除済みのID(`deleted`)は取得が成功したとき(`LoadedRoundsList`)にだけ持つ。合計点は`roundListItemOf`が求める。
- `features/rounds/domain/round-routes.ts`（domain）: ラウンドの画面の経路の判定・変換(経路に対応する枠を返す`roundFramePathOf`、経路からIDを読む`roundIdOfPath`)。経路の定数(`ROUNDS_PATH`、`NEW_ROUND_PATH`、`roundPath`)は経路表(`src/routes.ts`)が持つ。
- `features/rounds/application/rounds-list-store.ts`（手続き）: 一覧の画面に渡す状態と変更の方法。`loadList()`は、端末の記録(`readList`)を読んで列で削除済みのラウンドのIDを求め、一覧の取得(`RoundFetching.fetchRoundsList`)を行い、失敗したときはその結果を返し、成功したら取得と削除済みのIDを返す。削除が確定済みでも端末の記録へは反映しない(反映は一括の取得の`refreshAll`が行う)。取得の拒否はそのまま伝え、画面の取得の hook が`error`にする。`loadLocalList()`は、端末の各組を`features/rounds/domain/round-view.ts`の`deriveRoundState`で状態にし、`features/rounds/domain/round-retention.ts`の`isRoundInProgress`が真のものを名前・実施日・合計点にする(`round-list.ts`)。保存済みの的は読まない。入力中と端末が保持するラウンドの一括の取得は、一覧とは別に同期が行う(`features/round-sync/application/round-sync.ts`、`features/rounds/application/round-base-refreshing.ts`)。ユーザーの突き合わせは行わない。ベースと操作の列は端末でユーザーごとに隔離され、取得の利用者と記録の利用者が`same`でない反映は端末へ保存されない。端末の記録の変化の購読(`subscribe`)も持つ。通信の復帰の合図(`whenOnline`)は手続きの入れ物から受ける。画面は時刻、乱数、通信の可否に触らない。
- `features/rounds/application/round-fetching.ts`（手続き）: 取得の順序。`fetchRoundsList`が、`fetchContent`（`features/rounds/application/content-fetcher.ts`）経由で認証を確かめて`RoundQueries.roundsList`を呼び、`roundListItemOf`で`RoundListItem[]`にする。
- `features/rounds/infrastructure/round-queries.ts`（インフラ層）: 一覧の問い合わせを`DatabaseGateway<RoundsDbSchema>`の`select`で行い、行を`ServerRoundSummary`(行と同形)のまま`QueryOutcome`で返す。`rounds-db-schema.ts`は並べる列(`round_date`)を含む。

一覧の取得は`.retry(false)`を付け、`rounds`から`distances(disabled_at, shots(score_int, disabled_at))`までのネストで1回行う。
- 対象は`rounds.disabled_at is null`で、並びは`round_date`の降順(`DbOrder`の`ascending: false`)である。同じ実施日の並びは定めない。
- 合計点は、無効でない距離の、無効でない矢の`score_int`の総和を、クライアントで計算する(`roundListItemOf`)。端末から導く入力中のラウンドも、状態の距離・矢から同じ規則で求める。
- 取得できる行は、RLSの`select_if_member`により、ユーザーが`round_users`で属するラウンドに限る。利用者では絞らない。
- 一覧はRPCを介さず、直接SELECTする。

## ファイルと層

| ファイル | 層 |
| :--- | :--- |
| `app/(main)/rounds/page.tsx` | 入口 |
| `features/rounds/ui/rounds-list.tsx` | ui(一覧の描画と削除のメニュー) |
| `features/rounds/ui/use-local-rounds-list.ts` | ui(端末の入力中のラウンドの読み込み) |
| `features/rounds/ui/use-fetch-result.ts`、`fetch-state.tsx` | ui(画面の取得の状態と再取得、取得の状態の表示) |
| `features/rounds/domain/rounds-list-view.ts` | domain(取得結果と入力中のラウンドの重ね合わせと、表示の内容の決定) |
| `features/rounds/domain/round-list.ts` | domain(削除済みと入力中と合計点の導出、一覧の材料の型) |
| `features/rounds/domain/round-routes.ts` | domain(ラウンドの画面の経路の判定・変換) |
| `features/rounds/application/rounds-list-store.ts`、`round-deletion.ts` | application(一覧の画面に渡す状態と変更の方法、削除。削除は手続きの入れ物から画面が直接受ける) |
| `features/rounds/application/round-fetching.ts` | application(取得の順序)と約束(`RoundQueries`) |
| `features/rounds/infrastructure/round-queries.ts` | infrastructure(一覧の問い合わせ) |
| `features/rounds/infrastructure/browser-unique-ids.ts` | infrastructure(新しいIDと、IDに混ぜる乱数(`randomBytes`)の払い出し) |
| `features/rounds/infrastructure/rounds-db-schema.ts` | infrastructure(ラウンドが使うスキーマの部分の型) |
| `features/rounds/index.ts` | 機能の入口(型だけを公開) |
| `hooks/use-hydrated.ts`、`components/ui/{confirm-dialog,busy-button,dialog,button}.tsx`、`lib/utils.ts` | 共有の画面部品 |
| `lib/supabase/contract/database.ts`、`lib/supabase/infrastructure/database.ts` | `lib/<能力>`(約束と実装: 並びの向き`ascending`) |

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| 合計点を、ネスト取得の結果からクライアントで計算する | 一覧の取得を1回に収めるため。合計点の列や集計ビューは持たない | ラウンド数が増え、取得量が問題になるとき |
| 入力中の領域は端末の列を表示の開始時に読み、記録が変わるたびに読み直す | 端末の記録の変化(一括の取得の反映、別のタブの変化)を取得の完了を待たずに反映するため | 読み直しの費用が問題になるとき |
| 論理削除された行を、ラウンド・距離・矢の3段階で一覧と合計点から除く | 削除を`disabled_at`で射影しており、無効化後の後続イベントも通常表示へ戻さないため | 削除の方式を変えるとき |
| 一覧の取得は、RPCでなくRLSの直接SELECTのまま残す | 書き込みをRPCへ統一する際も、SELECTポリシーは維持する方針のため | 読み取りも認可RPCへ統一するとき |
| 枠は静的にし、取得はクライアントから行う（枠をSWが返す前提。詳細は#648） | 静的な枠を即座に返し、取得の失敗を枠内で区別して示すため | 一覧をサーバーで取得する必要が生じたとき |
| 新規作成ボタンを右下に固定し、常時表示する | 一覧から作成画面へ辿る導線を常に示すため | 作成の導線を別へ移すとき |
| 新規作成ボタンに`data-hydrated`を付ける | ハードナビゲーション直後の操作が、ハイドレーション前に空振りするのをE2Eが待てるようにするため | ハイドレーション完了の通知を共通化するとき |
| 一覧の取得と一括の取得を別々に行い、一覧は一括の取得を待たず、一括の失敗で隠さない | 一覧の表示を一括の取得の成否に依存させないため。入力中の区画は端末の記録から作り、他の端末で完了したラウンドが残る時間は、次の契機(起動、通信の復帰、画面が見える状態)まで延びる | 入力中の区画の鮮度が問題になるとき |
| 一覧の取得から入力中のラウンドを除かず、入力中の領域のIDを除いてそれ以外の並びにする | 除いてもIDの重複の排除は残り、端末で完了にした未送信のラウンドの規則が増え、2つの取得の時刻のずれでラウンドが消えるため | ページ送りを入れ、ページの件数を領域と別に数えるとき(#387) |
| 入力中のラウンドは、実施日に関わらず先頭の見出し付きの領域にまとめ、無いときは領域を出さない | 一覧から入力中のラウンドを見つけて開けるようにし、取得の前後で位置を変えないため | 入力中のラウンドが多く、領域が長くなるとき |
| 入力中のラウンドは、詳細と同じ導出(`deriveRoundState`)と表示の規則で決め、保持の規則を使わない。的は使わない | 一覧と詳細の値を一致させ、完了で未送信の変更が残るラウンドを入力中と見せないため。的は画面に出ず、未送信の矢の点数が距離の的に無い異常系だけ合計が詳細と異なり得る(送信と取得の後は一致する) | 一覧に入力中でないラウンドを端末から出すとき、一覧に的を使う表示が入るとき |
| 入力中の領域は常に端末の値で出し、取得は裏で行う | 入力中の領域は取得の前後で端末の値のままで、取得で変わるのは過去履歴の部分だけのため | 入力中の領域に取得の値を混ぜるとき |
| 一覧の取得と端末の入力中の読み込みを`RoundsListStore`に持たせ、削除と通信の復帰の合図は手続きの入れ物から受ける。画面は時刻、乱数、通信の可否に触らない | 画面に渡す形を1つにし、画面を変えずに手続きを検証するため。窓口は判断か写しを持つメンバーだけにする | 画面に別の手続きを渡す必要が出たとき |
| 作成と詳細の経路を一覧の経路から作り、経路表(`src/routes.ts`)が持つ | 一覧の経路の文字列の持ち主を1つにするため | 画面の経路の階層を変えるとき |
| 一覧はユーザーを突き合わせず、現在のハブのユーザーの組を読むだけにする | ベースと操作の列はストアとハブでユーザーごとに隔離され、詳細も同じ前提で読むため。一覧で毎回突き合わせる仕組みは、隔離と重複するため採らない | ハブのユーザーの切り替えの手順を変えるとき |

## 制約と未対応

- 全件を1回で取得し、ページングや上限はない。
- オフライン表示のときは、通信の復帰（手続きの入れ物の`whenOnline`）で自動再取得する。通信失敗（`navigator.onLine`が`true`のまま）を含むエラーは、自動で取り直さず、再試行ボタンで取得し直す。
- 完了で未送信の変更が残るラウンドは、取得の値で出し、オフラインでは出さない。
- 一括の取得は一覧を開いても起こさず、起動、通信の復帰、画面が見える状態で行う。
- 利用者が並び順や絞り込みを選ぶ操作は持たない。
