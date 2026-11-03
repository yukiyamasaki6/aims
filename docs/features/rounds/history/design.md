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
| 取得中 | `FALLBACK_WAIT_MS`までは出さない。過ぎたら端末から導いた入力中のラウンド | スケルトン。入力中の領域を出すときは見出し「過去履歴」の下 |
| エラー | 端末から導いた入力中のラウンド | 入力中の領域を出すときは見出し「過去履歴」の下にエラーメッセージと再試行ボタン。通信失敗は「読み込めませんでした。」。未認証は「サインインが必要です。」 |

- 領域は節(`flex flex-col gap-2`)で、見出し「入力中」(`h2`、`text-sm font-medium`)の下にカードを並べる。入力中のラウンドが無いときは、見出しごと出さない。カードに「入力中」の印は付けず、端末から導いたカードと取得したカードを見た目で区別しない。
- 下の部分の見出し「過去履歴」は、入力中の領域を出しているときだけ付ける。取得が成功し、入力中でないラウンドが0件のときは、節を見出しごと出さない。オフライン・エラーの表示は、この節の残りの領域の中央に置く。
- 取得が完了すると、入力中の領域は取得を反映した値に、その下は取得したカードに、1回で置き換わる。他端末が完了にしたラウンドは、入力中の領域から外れ、下の部分に出る。
- 再試行ボタンを押すと、その下がスケルトンになる。入力中の領域は、表示の開始から`FALLBACK_WAIT_MS`が過ぎていれば出したままにする。過ぎる前は取得中の規則に従い、出さない(待ちの経過は表示の開始からで、再試行では戻らない)。
- 入力中のラウンドのカードも、既存のメニューと確認で削除でき、その場で消える。最後の1件を消すと、領域は見出しごと消える。
- 新規作成ボタンは、全状態で常に表示する。
- 未認証のアクセスは`proxy.ts`が`/signin`へ送る。この挙動は一覧の要求に含めない。

## 構成とデータの流れ

パスは、断りがなければ`apps/web/src/`からの相対である。

- `app/(main)/rounds/page.tsx`（Client Component、画面の入口）: 枠（見出し）を描画し、`RoundsList`を描く。何も生成せず、取得もせず、`cookies()`も読まない。
- `features/rounds/ui/rounds-list.tsx`（UI層、Client Component）: `RoundsListStore`の`loadList`の結果から`roundsListView`が決めた内容に応じて、領域・カード・削除メニュー、または取得中・オフライン・エラーの表示を描画する。新規作成ボタンは全状態で描画する。カードと新規作成ボタンの行き先は`roundPath`、`NEW_ROUND_PATH`である。自分の削除は`RoundsListStore.deleteRound`で行い、この画面の削除済みの集合へ足して除き、取得の状態が変わっても失わない。読み込みの全体を`withinFetchTimeout`で10秒に打ち切る(`app/offline-pwa`)。
- `features/rounds/ui/use-local-rounds-list.ts`（UI層）: 表示の開始時に`RoundsListStore.loadLocalList`を1回読み、`RoundsListStore.afterFallbackWait`で`FALLBACK_WAIT_MS`が過ぎたことを返す。購読しない。
- `features/rounds/ui/use-fetch-result.ts`、`fetch-state.tsx`（UI層）: 画面の取得の状態と再取得、取得の状態の表示。オフラインの間は、画面が渡す窓口の`whenOnline`(一覧は`RoundsListStore.whenOnline`)で通信の復帰を受ける。
- `features/rounds/domain/rounds-list-view.ts`（ドメイン層、ドメインサービス）: 取得結果を、入力中の領域とそれ以外の並びに分ける(`overlayRoundsList`)。それ以外 = 取得 − 入力中の領域のID − 削除済みで、値は取得の値のまま(完了で未送信の変更が残るラウンドを端末の値で出さない)。どちらも実施日の新しい順に安定ソートし、同じ実施日は取得の順、取得に無い入力中のラウンドはその後に置く。`roundsListView`は、取得の状態と端末の入力中のラウンドと待ちの経過から、画面に出す内容を決める純粋関数である。
- `features/rounds/domain/round-list.ts`（ドメイン層、ドメインサービス）: 一覧の材料の型(`LoadedRoundsList`、`LocalRoundsList`、`ServerRoundSummary`)と、削除済みと入力中と合計点の導出を持つ。合計点は`roundListItemOf`が求める。
- `features/rounds/domain/round-routes.ts`（ドメイン層、値オブジェクト）: ラウンドの画面の経路(`ROUNDS_PATH`、`NEW_ROUND_PATH`、`roundPath`、経路からIDを読む`roundIdOfPath`)。
- `features/rounds/application/rounds-list-store.ts`（手続き）: 一覧の画面に渡す状態と変更の方法。`loadList()`は一覧の取得を自分で行い、取得の前に端末の記録(`readAll`)を読み、列で削除済みのラウンドを求める。続けて一覧の取得(`RoundFetching.fetchRoundsList`)と、入力中と端末が保持するラウンドの一括の取得の依頼を並行に行い、両方が成功したときだけ成功とする。どちらかが失敗したときは、一覧の取得の結果、なければ一括の取得の結果を返す。一括の取得は同期が行い、一覧の取得が成功したときだけ端末の記録へ反映する(`features/round-sync/application/round-sync.ts`、`features/rounds/application/refresh-round-bases.ts`)。両方が成功したら、削除が確定済みのラウンドを削除の印として反映し(取得の内容とは照合せず、確定済みの操作を反映済みとして列から外す。削除の確定の後に始めた取得には、どのページ・フィルタでも現れないため)、その後に入力中のラウンドを求めて返す。入力中のラウンドは、端末の各組を`features/rounds/domain/round-view.ts`の`deriveRoundState`(保存済みの的を使う)で状態にし、`features/rounds/domain/round-retention.ts`の`isRoundInProgress`が真のものを名前・実施日・合計点にする(`round-list.ts`)。ユーザーの突き合わせは行わない。ベースと操作の列は端末でユーザーごとに隔離され、取得の利用者と記録の利用者が`same`でない反映は端末へ保存されない。削除(`deleteRound`。手続き`delete-round.ts`へ委譲する)、通信の復帰の合図(`whenOnline`)、待ちの経過の合図(`afterFallbackWait`)も持つ。画面は時刻、乱数、通信の可否に触らない。
- `features/rounds/application/fetch-round-detail.ts`（手続き）: 取得の順序。`fetchRoundsList`が、`fetchContent`（`features/rounds/application/fetch-content.ts`）経由で認証を確かめて`RoundQueries.roundsList`を呼び、`roundListItemOf`で`RoundListItem[]`にする。
- `features/rounds/infrastructure/round-queries.ts`（インフラ層）: 一覧の問い合わせを`DatabaseGateway<RoundsDbSchema>`の`select`で行い、行をドメインの形(`ServerRoundSummary`)に写す。`rounds-db-schema.ts`は並べる列(`round_date`)を含む。

一覧の取得は`.retry(false)`を付け、`rounds`から`distances(disabled_at, shots(score_int, disabled_at))`までのネストで1回行う。
- 対象は`rounds.disabled_at is null`で、並びは`round_date`の降順(`DbOrder`の`ascending: false`)である。同じ実施日の並びは定めない。
- 合計点は、無効でない距離の、無効でない矢の`score_int`の総和を、クライアントで計算する(`roundListItemOf`)。端末から導く入力中のラウンドも、状態の距離・矢から同じ規則で求める。
- 取得できる行は、RLSの`select_if_member`により、ユーザーが`round_users`で属するラウンドに限る。利用者では絞らない。
- 一覧はRPCを介さず、直接SELECTする。

## 対応表

この作業で方針を適用したファイルと用語である。

| ファイル | 用語 |
| :--- | :--- |
| `app/(main)/rounds/page.tsx` | 画面の入口 |
| `features/rounds/ui/rounds-list.tsx` | UI層(一覧の描画と削除のメニュー) |
| `features/rounds/ui/use-local-rounds-list.ts` | UI層(端末の入力中のラウンドの読み込みと待ちの経過) |
| `features/rounds/ui/use-fetch-result.ts`、`fetch-state.tsx` | UI層(画面の取得の状態と再取得、取得の状態の表示) |
| `features/rounds/domain/rounds-list-view.ts` | ドメイン層(ドメインサービス: 取得結果と入力中のラウンドの重ね合わせと、表示の内容の決定) |
| `features/rounds/domain/round-list.ts` | ドメイン層(ドメインサービス: 削除済みと入力中と合計点の導出、一覧の材料の型) |
| `features/rounds/domain/round-routes.ts` | ドメイン層(値オブジェクト: ラウンドの画面の経路) |
| `features/rounds/application/rounds-list-store.ts`、`delete-round.ts` | 手続き(一覧の画面に渡す状態と変更の方法、削除) |
| `features/rounds/application/fetch-round-detail.ts` | 手続き(取得の順序)と約束(`RoundQueries`) |
| `features/rounds/infrastructure/round-queries.ts` | インフラ層(一覧の問い合わせと行の写し) |
| `features/rounds/infrastructure/browser-unique-ids.ts` | インフラ層(新しいIDと、IDに混ぜる乱数(`randomBytes`)の払い出し) |
| `features/rounds/infrastructure/rounds-db-schema.ts` | インフラ層(ラウンドが使うスキーマの部分の型) |
| `features/rounds/index.ts` | 機能の入口(`ROUNDS_PATH`を公開) |
| `hooks/use-hydrated.ts`、`components/ui/{confirm-dialog,busy-button,dialog,button}.tsx`、`lib/utils.ts` | 共有の画面部品 |
| `lib/supabase/contract/database.ts`、`lib/supabase/infrastructure/database.ts` | 共有の技術の約束と実装(並びの向き`ascending`) |

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| 合計点を、ネスト取得の結果からクライアントで計算する | 一覧の取得を1回に収めるため。合計点の列や集計ビューは持たない | ラウンド数が増え、取得量が問題になるとき |
| 一覧は端末の列を購読せず、取得時に1回読む | 要件は取得し直しでの反映を許容し、購読より単純なため | 別のタブの変化を即座に反映するとき |
| 論理削除された行を、ラウンド・距離・矢の3段階で一覧と合計点から除く | 削除を`disabled_at`で射影しており、無効化後の後続イベントも通常表示へ戻さないため | 削除の方式を変えるとき |
| 一覧の取得は、RPCでなくRLSの直接SELECTのまま残す | 書き込みをRPCへ統一する際も、SELECTポリシーは維持する方針のため | 読み取りも認可RPCへ統一するとき |
| 枠は静的にし、取得はクライアントから行う（枠をSWが返す前提。詳細は#648） | 静的な枠を即座に返し、取得の失敗を枠内で区別して示すため | 一覧をサーバーで取得する必要が生じたとき |
| 新規作成ボタンを右下に固定し、常時表示する | 一覧から作成画面へ辿る導線を常に示すため | 作成の導線を別へ移すとき |
| 新規作成ボタンに`data-hydrated`を付ける | ハードナビゲーション直後の操作が、ハイドレーション前に空振りするのをE2Eが待てるようにするため | ハイドレーション完了の通知を共通化するとき |
| 一覧の取得と一括の取得を並行に行い、両方が成功したときだけ取得の結果とする | 入力中のラウンドの値を、新しいベースに未送信の操作を重ねた値にし、他端末の変更を端末の古いベースで隠さないため。端末の組だけを使う案は、未送信の操作があるラウンドで他端末の変更を隠すため採らない | 一覧の取得量・回数が問題になるとき |
| 一覧の取得から入力中のラウンドを除かず、入力中の領域のIDを除いてそれ以外の並びにする | 除いてもIDの重複の排除は残り、端末で完了にした未送信のラウンドの規則が増え、2つの取得の時刻のずれでラウンドが消えるため | ページ送りを入れ、ページの件数を領域と別に数えるとき(#387) |
| 入力中のラウンドは、実施日に関わらず先頭の見出し付きの領域にまとめ、無いときは領域を出さない | 一覧から入力中のラウンドを見つけて開けるようにし、取得の前後で位置を変えないため | 入力中のラウンドが多く、領域が長くなるとき |
| 入力中のラウンドは、詳細と同じ導出(`deriveRoundState`)と表示の規則で決め、保持の規則を使わない | 一覧と詳細の値を一致させ、完了で未送信の変更が残るラウンドを入力中と見せないため | 一覧に入力中でないラウンドを端末から出すとき |
| 取得中は`FALLBACK_WAIT_MS`を待ってから入力中の領域を出す | 通信できるときに、端末の値から取得の値への入れ替わりを見せないため(詳細と同じ値) | 待ちの値を変えるとき |
| 一覧の取得と削除と画面の合図を`RoundsListStore`に持たせ、画面は時刻、乱数、通信の可否に触らない | 画面に渡す形を1つにし、画面を変えずに手続きを検証するため(L01、X01) | 画面に別の手続きを渡す必要が出たとき |
| 作成と詳細の経路を一覧の経路から作り、`round-routes.ts`が持つ | 一覧の経路の文字列の持ち主を1つにするため | 画面の経路の階層を変えるとき |
| 一覧はユーザーを突き合わせず、現在のハブのユーザーの組を読むだけにする | ベースと操作の列はストアとハブでユーザーごとに隔離され、詳細も同じ前提で読むため。一覧で毎回突き合わせる仕組みは、隔離と重複するため採らない | ハブのユーザーの切り替えの手順を変えるとき |

## 制約と未対応

- 全件を1回で取得し、ページングや上限はない。
- オフライン表示のときは、通信の復帰（`RoundsListStore.whenOnline`）で自動再取得する。通信失敗（`navigator.onLine`が`true`のまま）を含むエラーは、自動で取り直さず、再試行ボタンで取得し直す。
- 完了で未送信の変更が残るラウンドは、取得の値で出し、オフラインでは出さない。
- 一覧を開くたびに一括の取得を1回行う。起動直後は`RoundBaseRefresher`の取得と重なるが、`startedAt`の比較で古い取得は新しい保存を上書きしない。
- 利用者が並び順や絞り込みを選ぶ操作は持たない。
