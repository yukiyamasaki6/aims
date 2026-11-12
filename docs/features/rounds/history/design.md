# rounds/history 設計

## 概要

ラウンドの画面を、ホーム(`/rounds`)と履歴(`/rounds/history`)に分ける。見出しは置かない。
ホームは、端末の記録の入力中のラウンドだけを表示する。履歴の取得も同期の完了も待たず、取得を起こさない。
入力中のラウンドは、端末が知る状態(取得したベースに未送信の操作を重ねた状態)から、詳細と同じ導出と表示の規則(`isRoundInProgress`)で決める。保持の規則(`rounds/sync`)は使わない。
履歴は、開いたときにサーバーで完了と記録されたラウンドだけを取得して表示する。取得結果から、端末の入力中のIDと削除済みを除く。端末の完了は履歴に出さず、取得が成功していないときはラウンドを出さない。
各カードに名前・実施日・合計点を出し、カードから`/rounds/[id]`へ、ホームの右下の新規作成ボタンから`/rounds/new`へ遷移する。
ホームと履歴は読み取り中心の画面で、書き込みはカードのメニューからの削除だけである。削除は`rounds/delete`が扱う。
取得はクライアントで行い、枠は静的である。
履歴の上端に、並べ替えと絞り込み(種別・弓種)を置く。条件は取得の後に端末で適用し、条件を変えても取得しない。条件と絞り込みの開閉はタブごとに保ち、別の利用者には引き継がない。

## 画面と状態

ホーム:

| 状態 | 表示 |
| :--- | :--- |
| 端末の入力中を読み込む前 | 何も出さない(空の表示も出さない) |
| 入力中が0件 | 「入力中のラウンドはありません」だけ |
| 入力中が1件以上 | 実施日の新しい順のカード(折りたたみ、見出し、線、件数バッジなし) |

- 新規作成ボタンは、ホームの全状態で表示する。ホームだけにあり、履歴・詳細・作成にはない。
- 同期の取得の状態(取得中・失敗・オフライン)で表示を変えない。同期の反映が端末の記録を変えると、購読で表示が更新される。
- 入力中のカードも、既存のメニューと確認で削除でき、その場で消える。

履歴(取得の状態は履歴の中にだけ出す):

| 状態 | 表示 |
| :--- | :--- |
| 取得中(端末の入力中の読み込み前を含む) | スケルトン |
| 取得の成功 | 条件を適用したラウンドのカード。0件なら、完了したラウンドがないときも条件に一致しないときも、「条件に一致するラウンドがありません」 |
| オフライン(`navigator.onLine`が`false`) | 「ネットワークに接続されていません」と再試行ボタン(`app/offline-pwa`) |
| エラー | エラーメッセージと再試行ボタン。通信失敗は「読み込めませんでした。」。未認証は「サインインが必要です。」 |

- 履歴の上端に、開閉の取っ手(「並べ替え・絞り込み」)と、その欄を置く。取っ手は取得の状態にかかわらず出し、保存した条件を読み終えるまでは出さず、取得中として扱う(端末の入力中の読み込みと同じ)。
- 欄には、並べ替え(基準「日付」「得点」と向き「昇順」「降順」)、絞り込み、「条件をリセット」を置く。リセットは押すと並べ替えと絞り込みを既定に戻す(開閉は変えない)。
- 閉じている間は欄を描かず、選んだ並べ替えと絞り込みの値もリセットも示さない。条件は適用され続け、表示するラウンドは変わらない。
- 絞り込みは、種別と弓種のそれぞれが「すべて」と各値の単一選択で、「すべて」が絞り込みなしである。選択肢の表示名は画面の既存の表記(`formatOption`、`bowTypeOption`)を使う。
- 初めて開いたときの絞り込みは開いている。
- 取得は表示の開始時に毎回行う。再試行ボタンを押すとスケルトンになる。
- 取得が成功していても、端末の入力中を読み終えるまでは取得中として扱う。
- 取得結果から除くのは、端末の入力中のID、取得時に端末の記録から求めた削除済みID、この画面で削除したラウンドのIDである。この除外は、条件の適用より先に行い、条件によらない。他の端末で完了して端末に未取り込みのラウンドは、端末の入力中に残るため、同期が反映するまで履歴に出ない(ホームと二重にしないため)。
- 履歴のカードのメニューと削除の確認は、ホームと同じである。
- 未認証のアクセスは`proxy.ts`が`/signin`へ送る。この挙動は一覧の要求に含めない。

## 構成とデータの流れ

パスは、断りがなければ`apps/web/src/`からの相対である。

### 条件の定義

何で並べ、何で絞るか。取得の形(どこで絞るか)から独立した、純粋な規則である。

- 条件(`HistoryCondition`)は、並べ替え(基準`date`か`score`、向き`asc`か`desc`)、種別(`FormatOption`か指定なし)、弓種(`BowTypeOption`か指定なし)の組である。基準は1つだけで、種別・弓種はそれぞれ1つだけ選べる。複数選択と複合ソートは持たない。
- 既定は、日付の降順・種別と弓種の指定なしである。表示の状態(`HistoryViewState`)は、条件と絞り込みの開閉の組で、開閉の既定は開である。
- 絞り込みは、指定がある属性だけを比べ、全ての指定に一致するラウンドを残す。
- 並べ替えの基準は、`date`が実施日、`score`が履歴のカードに出す合計点である。基準が同じラウンドは、実施日の新しい順、それも同じなら作成時刻の新しい順、それも同じならIDの順に並べる。同値の並びは基準の向きによらず、再読み込みしても変わらない。
- 条件の適用(`applyHistoryCondition`)は、履歴の項目の列と条件から、絞り込んで並べた列を返す純粋関数で、並びの規則の持ち主はここだけである。
- 保存した値の検証(`historyViewStateOf`)は、未知の値や形の崩れを既定に直す。

### 取得の形

どこで絞り、どこで並べるか。

- 履歴の取得は、条件によらず1回で、サーバーで完了と記録された全件を取得する。条件はサーバーへ渡さず、取得の後に端末で適用する。取得の問い合わせは並びを持たない(並びの持ち主を条件の適用の1つにするため)。
- 取得する列に、種別(`format`)、弓種(`bow_type`)、作成時刻(`created_at`)を足す。履歴の項目(`HistoryRoundItem`)は、ホームと共有する項目(`RoundListItem`)に、この3つを加えた型で、ホームの項目と導出は変えない。
- 条件を変えても、取得も同期も起こさない。取得中・失敗・オフラインの表示は条件によらず現行のままである。
- 履歴の表示の決定(`historyView`)は、除外の後に条件の適用を行う。ラウンドの削除は除外の集合へ足すため、条件に一致する表示からも消える。

### 条件の保持

- 条件と開閉は、タブごとの保存先(`sessionStorage`)に、利用者のIDを添えて記憶する。画面は表示の開始後に記憶を読み、変更のたびに書く。読む前は条件を持たない。
- 記憶の約束(`HistoryViewMemory`: 読む、書く)はapplicationに置き、実装はinfrastructureが持つ。実装は、保存値の利用者が端末の識別情報(`IdentityReader`)の利用者と違うとき、無いとき、検証できないときは既定を返す。保存先を使えないときは、画面の間だけ記憶なしで動く。端末の識別情報の利用者が無いときは、書き込みは何も書かず、読み込みは既定を返す。
- 別の利用者には、保存値の利用者の照合だけで引き継がない。サインアウトでは破棄しない。同じ利用者が再サインインすると、同じタブでは条件と開閉が残る。
- 別のタブとは共有しない。新しいタブは、初めて開いたときの状態(既定の条件、開)から始まる。
- 画面は、記憶を手続きの入れ物から受ける(`rounds-context.tsx`)。

- `app/(main)/rounds/page.tsx`（入口）: `<main>`の中に`RoundsHome`だけを描く。`app/(main)/rounds/history/page.tsx`（入口）は`RoundsHistory`だけを描く。どちらも静的で、何も生成せず、取得もせず、`cookies()`も読まない。見出しはsr-onlyも置かない。
- `features/rounds/ui/rounds-home.tsx`（UI層、Client Component）: `useLocalRoundsList`と手続きの入れ物の`deletion`だけを使う。`homeView`が決めた入力中のカード、0件の表示、削除の確認、新規作成ボタンを描く。履歴の取得の hook と`whenOnline`は使わない。
- `features/rounds/ui/rounds-history.tsx`（UI層、Client Component）: `RoundsListStore`の`loadList`の結果と端末の入力中と、条件(`use-history-view.ts`)から`historyView`が決めた内容に応じて、上端の操作(`history-controls.tsx`)の下に、カード、または取得中・オフライン・エラーの表示を描画する。0件の文言は1つである。読み込みの全体を`withinFetchTimeout`で10秒に打ち切る(`app/offline-pwa`)。
- `features/rounds/ui/use-history-view.ts`、`history-controls.tsx`（UI層）: 記憶から条件と開閉を読み(読む前はnull)、並べ替え・絞り込み・開閉・既定に戻す操作を受けて状態を更新し記憶へ書く。操作の部品は、並べ替え、絞り込み(開いているときだけ)、開閉、リセットを描く。
- `features/rounds/ui/round-cards.tsx`（UI層）: カード、メニュー、スケルトン。履歴のカードだけが遷移元`history`を渡し、詳細へのリンクに`?from=history`が付く(`rounds/detail`)。
- `features/rounds/ui/round-delete.tsx`（UI層）: ホームと履歴が共有する、削除済みの集合(`removed`)、確認の対象、確認ダイアログ。削除は手続きの入れ物の`deletion.deleteRound`で行い、`removed`へ足して除き、取得の状態が変わっても失わない。
- `features/rounds/ui/use-local-rounds-list.ts`（UI層）: 窓口(`RoundWindow`)の`watchLocalList`/`localList`を`useSyncExternalStore`で購読する。一括の取得の反映も届く。読み終えるまで(サーバー描画、水和を含む)は`null`を返す。
- `features/rounds/ui/use-fetch-result.ts`、`fetch-state.tsx`（UI層）: 画面の取得の状態と再取得、取得の状態の表示。オフラインの間は、画面が渡す`whenOnline`で通信の復帰を受ける。
- `features/rounds/domain/rounds-list-view.ts`（domain）: 表示の内容を決める純粋関数。`homeView(local, removed)`は端末の入力中から`removed`を除き、実施日の新しい順に返す(読み込み前はnull)。`historyView(view, local, removed, condition)`は、取得が成功し端末の入力中を読み終えているときだけ、取得結果から端末の入力中のID、削除済み(`view.data.deleted`と`removed`)を除き、条件を適用したラウンドを返す。それ以外はラウンドを持たず、取得の状態だけを返す。
- `features/rounds/domain/round-list.ts`（domain）: 一覧の材料の型(`LoadedRoundsList`、`LocalRoundsList`、`ServerRoundSummary`)と、削除済みと入力中と合計点の導出を持つ。`ServerRoundSummary`は取得した行と同形(列名`round_date`、`bow_type`、`created_at`、`disabled_at`のまま。生成型から導く)で、画面の名前への写しは`roundListItemOf`の1か所である。端末の記録だけから求める入力中のラウンド(`LocalRoundsList`)は削除済みを入れず、削除済みのID(`deleted`)は取得が成功したとき(`LoadedRoundsList`)にだけ持つ。
- `features/rounds/domain/round-routes.ts`（domain）: ラウンドの画面の経路の判定・変換(経路に対応する枠を返す`roundFramePathOf`。履歴の枠を詳細の枠より先に判定する)。遷移元の型と変換(`RoundOrigin`、`roundOriginOf`、`originPathOf`)は`rounds/detail`が扱う。経路の定数(`ROUNDS_PATH`、`ROUNDS_HOME_PATH`、`ROUNDS_HISTORY_PATH`、`NEW_ROUND_PATH`、`roundPath`)は経路表(`src/routes.ts`)が持つ。
- `features/rounds/domain/history-view-state.ts`（domain）: 条件と表示の状態の型、既定、条件の適用、保存値の検証(「条件の定義」)。
- `features/rounds/application/history-view-memory.ts`（application）: 記憶の約束(「条件の保持」)。
- `features/rounds/infrastructure/browser-history-view-memory.ts`（インフラ層）: タブごとの保存先と利用者の照合による記憶の実装。
- `features/rounds/application/rounds-list-store.ts`（手続き）: 履歴の画面に渡す状態。`loadList()`は、端末の記録(`readList`)を読んで削除済みのラウンドのIDを求め、履歴の取得(`RoundFetching.fetchRoundsList`)を行い、失敗したときはその結果を返し、成功したら取得と削除済みのIDを返す。削除が確定済みでも端末の記録へは反映しない(反映は一括の取得の`refreshAll`が行う)。取得の拒否はそのまま伝え、画面の取得の hook が`error`にする。端末内の入力中の一覧は窓口(`features/rounds/application/round-window.ts`の`watchLocalList`/`localList`)が持つ。窓口は購読者が0→1で端末の記録を購読し、変化を同じティックで1回にまとめ、全ての列から導き直し、構造が同値なら参照を変えず通知しない。1→0で値を捨てる(再購読は`null`から始める)。導き直しは、端末の各組を`features/rounds/domain/round-view.ts`の`deriveRoundState`で状態にし、`features/rounds/domain/round-retention.ts`の`isRoundInProgress`が真のものを名前・実施日・合計点にする(`round-list.ts`)。保存済みの的は読まない。入力中と端末が保持するラウンドの一括の取得は、履歴の取得とは別に同期が行う(`features/round-sync/application/round-sync.ts`、`features/rounds/application/round-base-refreshing.ts`)。ユーザーの突き合わせは行わない。ベースと操作の列は端末でユーザーごとに隔離され、取得の利用者と記録の利用者が`same`でない反映は端末へ保存されない。通信の復帰の合図(`whenOnline`)は手続きの入れ物から受ける。画面は時刻、乱数、通信の可否に触らない。
- `features/rounds/application/round-fetching.ts`（手続き）: 取得の順序。`fetchRoundsList`が、`fetchContent`（`features/rounds/application/content-fetcher.ts`）経由で認証を確かめて`RoundQueries.roundsList`を呼び、`roundListItemOf`で`RoundListItem[]`にする。
- `features/rounds/infrastructure/round-queries.ts`（インフラ層）: 履歴の問い合わせを`DatabaseGateway<RoundsDbSchema>`の`select`で行い、行を`ServerRoundSummary`(行と同形)のまま`QueryOutcome`で返す。`rounds-db-schema.ts`は実施日の列を含む。名前(`roundsList`、`fetchRoundsList`、`loadList`、`RoundsListStore`)は据え置き、履歴の取得を指す。

履歴の取得は`.retry(false)`を付け、`rounds`から`distances(disabled_at, shots(score_int, disabled_at))`までのネストで1回行う。
- 対象は`rounds.disabled_at is null`かつ`rounds.status = 'completed'`で、並びは指定しない(並びは条件の適用が決める)。
- 合計点は、無効でない距離の、無効でない矢の`score_int`の総和を、クライアントで計算する(`roundListItemOf`)。端末から導く入力中のラウンドも、状態の距離・矢から同じ規則で求める。
- 取得できる行は、RLSの`select_if_member`により、ユーザーが`round_users`で属するラウンドに限る。利用者では絞らない。
- 履歴はRPCを介さず、直接SELECTする。

## ファイルと層

| ファイル | 層 |
| :--- | :--- |
| `app/(main)/rounds/page.tsx`、`app/(main)/rounds/history/page.tsx` | 入口 |
| `features/rounds/ui/rounds-home.tsx` | ui(ホームの描画) |
| `features/rounds/ui/rounds-history.tsx` | ui(履歴の描画) |
| `features/rounds/ui/round-cards.tsx`、`round-delete.tsx` | ui(カードとメニュー、削除の確認。ホームと履歴で共有) |
| `features/rounds/ui/use-local-rounds-list.ts` | ui(端末の入力中のラウンドの購読) |
| `features/rounds/application/round-window.ts` | application(端末内の入力中一覧の購読) |
| `features/rounds/ui/use-fetch-result.ts`、`fetch-state.tsx` | ui(画面の取得の状態と再取得、取得の状態の表示) |
| `features/rounds/domain/rounds-list-view.ts` | domain(ホームと履歴の表示の内容の決定) |
| `features/rounds/domain/round-list.ts` | domain(削除済みと入力中と合計点の導出、一覧の材料の型) |
| `features/rounds/domain/history-view-state.ts` | domain(条件と表示の状態、条件の適用、保存値の検証) |
| `features/rounds/application/history-view-memory.ts` | application(記憶の約束) |
| `features/rounds/infrastructure/browser-history-view-memory.ts` | infrastructure(タブごとの記憶の実装) |
| `features/rounds/ui/use-history-view.ts`、`history-controls.tsx` | ui(条件の読み書きと操作の部品) |
| `features/rounds/domain/round-routes.ts` | domain(ラウンドの画面の経路の判定・変換) |
| `features/rounds/application/rounds-list-store.ts`、`round-deletion.ts` | application(履歴の画面に渡す状態、削除。削除は手続きの入れ物から画面が直接受ける) |
| `features/rounds/application/round-fetching.ts` | application(取得の順序)と約束(`RoundQueries`) |
| `features/rounds/infrastructure/round-queries.ts` | infrastructure(履歴の問い合わせ) |
| `features/rounds/infrastructure/browser-unique-ids.ts` | infrastructure(新しいIDと、IDに混ぜる乱数(`randomBytes`)の払い出し) |
| `features/rounds/infrastructure/rounds-db-schema.ts` | infrastructure(ラウンドが使うスキーマの部分の型) |
| `features/rounds/index.ts` | 機能の入口(型だけを公開) |
| `hooks/use-hydrated.ts`、`components/ui/{confirm-dialog,busy-button,dialog,button}.tsx`、`lib/utils.ts` | 共有の画面部品 |
| `lib/supabase/contract/database.ts`、`lib/supabase/infrastructure/database.ts` | `lib/<能力>`(約束と実装) |

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| ホームを履歴の取得から切り離す | 入力するために＋を押す利用者が、履歴の取得を経由しないため。ホームが取得を経由しないことを、取得する部品を持たない構造で保証する | ホームに履歴由来の表示を足すとき |
| 履歴の取得をサーバーの`status = completed`で絞り、端末の完了を合わせない | 「サーバーで完了と記録されたものだけ」の要件と一致し、入力中や端末だけの完了を取得しないため。全件取得して画面で除く案は、規則を画面の条件に頼るため採らない | 端末の完了を履歴に出す要件になったとき |
| 履歴から、端末の入力中のIDと削除済みの2つを除く | 他の端末で完了したラウンドが同期の反映までホームと履歴の両方に出ること、削除のサーバー受理までの間に出ることを防ぐため | 同期との時間差がなくなるとき |
| `ROUNDS_HOME_PATH`と`ROUNDS_PATH`を同じ値で持ち分ける | ホームを指す呼び出しと、画面全体の範囲(保護の範囲、枠)を指す呼び出しを区別し、`HOME_PATH`(`/`)との取り違えを避けるため | 範囲とホームの値が分かれるとき |
| 見出しを置かない(sr-onlyも置かない) | 要件のため。切替の項目と現在のビューの表示が画面を示す | 見出しが要件に戻るとき |
| 合計点を、ネスト取得の結果からクライアントで計算する | 履歴の取得を1回に収めるため。合計点の列や集計ビューは持たない | ラウンド数が増え、取得量が問題になるとき |
| ホームの入力中は端末の列を表示の開始時に読み、記録が変わるたびに読み直す | 端末の記録の変化(一括の取得の反映)を取得を待たずに反映するため | 読み直しの費用が問題になるとき |
| 論理削除された行を、ラウンド・距離・矢の3段階で履歴と合計点から除く | 削除を`disabled_at`で射影しており、無効化後の後続イベントも通常表示へ戻さないため | 削除の方式を変えるとき |
| 履歴の取得は、RPCでなくRLSの直接SELECTのまま残す | 書き込みをRPCへ統一する際も、SELECTポリシーは維持する方針のため | 読み取りも認可RPCへ統一するとき |
| 枠は静的にし、取得はクライアントから行う（枠をSWが返す前提。詳細は#648） | 静的な枠を即座に返し、取得の失敗を枠内で区別して示すため | 履歴をサーバーで取得する必要が生じたとき |
| 新規作成ボタンをホームの右下に固定し、ホームの全状態で表示する | 入力の入口を常に示し、履歴の取得の状態に左右されないため | 作成の導線を別へ移すとき |
| 新規作成ボタンに`data-hydrated`を付ける | ハードナビゲーション直後の操作が、ハイドレーション前に空振りするのをE2Eが待てるようにするため | ハイドレーション完了の通知を共通化するとき |
| 履歴の取得と一括の取得を別々に行い、履歴は一括の取得を待たず、一括の失敗で隠さない | 履歴の表示を一括の取得の成否に依存させないため。ホームは端末の記録から作り、他の端末で完了したラウンドが残る時間は、次の契機(起動、通信の復帰、画面が見える状態)まで延びる | ホームの鮮度が問題になるとき |
| 入力中のラウンドは、詳細と同じ導出(`deriveRoundState`)と表示の規則で決め、保持の規則を使わない。的は使わない | 一覧と詳細の値を一致させ、完了で未送信の変更が残るラウンドを入力中と見せないため。的は画面に出ず、未送信の矢の点数が距離の的に無い異常系だけ合計が詳細と異なり得る(送信と取得の後は一致する) | 一覧に的を使う表示が入るとき |
| 履歴の取得と端末の入力中の読み込みを`RoundsListStore`に持たせ、削除と通信の復帰の合図は手続きの入れ物から受ける。画面は時刻、乱数、通信の可否に触らない | 画面に渡す形を1つにし、画面を変えずに手続きを検証するため。窓口は判断か写しを持つメンバーだけにする | 画面に別の手続きを渡す必要が出たとき |
| 作成と詳細の経路を経路表(`src/routes.ts`)が持つ | 経路の文字列の持ち主を1つにするため | 画面の経路の階層を変えるとき |
| 条件を取得の後に端末で適用し、サーバーへ渡さない | 得点の並びは合計点(クライアントの計算)が基準で、サーバーでは並べられず、日付・種別・弓種だけサーバーに任せると並びの規則が2か所に分かれるため。条件の変更が取得を起こさず、取得の状態の表示とも干渉しない | 全件の取得をやめる(ページ送り、#387)とき |
| 並びの規則の持ち主を条件の適用1つにし、取得の問い合わせは並べない | 同値の並び(実施日、作成時刻、ID)を含め、並びを決める場所を1つにするため | 並びをサーバーへ移すとき |
| 並べ替え・絞り込み・リセットを同じ開閉の欄に置く | 並べ替えと絞り込みの条件を1つの欄で扱い、閉じている間は両方とも示さず適用し続けるというユーザーの判断のため。リセットは両方を戻す操作で、欄の中に置く(欄の外に置くと、閉じている間の押せるかどうかで条件の適用中を示すため) | 並べ替えの現在値を常に示す要求が出たとき |
| 条件をタブごとの保存先(`sessionStorage`)に、利用者を添えて記憶する | 再読み込みと詳細からの戻りで保て、アプリの起動で前回のビューを復元しない現行の要求と、他のタブとの食い違いの書き込みを避けるため。端末全体の保存先は、新しい起動でも復元するため採らない。利用者の照合は、別の利用者への引き継ぎを防ぐ | 起動をまたぐ復元の要求が出たとき |
| 履歴はユーザーを突き合わせず、現在のハブのユーザーの組を読むだけにする | ベースと操作の列はストアとハブでユーザーごとに隔離され、詳細も同じ前提で読むため。毎回突き合わせる仕組みは、隔離と重複するため採らない | ハブのユーザーの切り替えの手順を変えるとき |

## 制約と未対応

- 履歴は全件を1回で取得し、ページングや上限はない(#387)。
- 履歴がオフライン表示のときは、通信の復帰（手続きの入れ物の`whenOnline`）で自動再取得する。通信失敗（`navigator.onLine`が`true`のまま）を含むエラーは、自動で取り直さず、再試行ボタンで取得し直す。
- 完了で未送信の変更が残るラウンドは、サーバーに完了が反映され、履歴を開いて取得するまで、ホームにも履歴にも出ない。
- 一括の取得は、ホームと履歴を開いても起こさず、起動、通信の復帰、画面が見える状態で行う。
- 条件は、日付・得点の並べ替えと、種別・弓種の絞り込み(それぞれ単一選択)だけである。閉じている間は、並べ替えと絞り込みのどちらの値も、適用中を示す表示もない。
- 別のタブとは条件を共有しない。サインアウトで条件を破棄しないため、同じ利用者が同じタブで再サインインすると条件と開閉が残る。
