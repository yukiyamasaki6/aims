# rounds/detail 設計

## 概要

`/rounds/[id]`でラウンドのスコアカードを表示する。
エンドごとの記録と小計、距離ごとの合計、ラウンド全体の合計と最高点数・X数を、1画面で確認する。
集計はクライアントの純粋関数で行い、的のリング構成から、Xの有無と最高点数・次の点数を導く。
画面の枠は静的で、ラウンドはクライアントが取得するため、オフラインでも枠は開き、取得の失敗を枠内で区別して表示する。
画面の状態は、ベース(取得した状態、通信できないときは端末に保持した状態)に操作の列を重ねた1つで、2つの規則で扱う。
的の一覧は、ラウンドの情報と同じく内容を出す前提とし、そろうまでは内容を出さず、ラウンドの取得と同じ取得中・オフライン・エラーの表示にする。
表示の規則は、状態が入力中のラウンドだけを「入力中」と見せる(`isRoundInProgress`。矢数に達していないエンドの有無や記録日では決めない)。
保持の規則は、状態が入力中か、ベースに反映されていない操作(未送信、または確定済みで取得に未反映)が残るラウンドを、オフラインで開けるよう端末に持つ(`shouldKeepRoundBase`)。完了で送信済みのラウンドと削除が受理されたラウンドは、ベースも操作も端末に残さない(削除されたラウンドには、古い取得による復活を防ぐ削除の印だけが残る)。
点数の入力は`rounds/score-entry`、設定の編集は`rounds/setup`、同期は`rounds/sync`が扱う。

## 画面と状態

| 領域 | 内容 | 固定表示 |
| :--- | :--- | :--- |
| 一覧へ戻る行 | 「一覧へ戻る」リンク、プリセット保存、ラウンドのメニュー | スクロール領域の外の上端 |
| ラウンドの結果 | 合計。条件を満たすときだけ最高点数・X数、または最高点数・次点数を併記 | 領域の上端 |
| 距離の結果 | 距離ごとの合計と、最高点数・X数、または最高点数・次点数 | 距離の範囲内で、領域の上端のラウンドの結果の下 |
| エンド | 各矢の点数(射順不明の矢は点数の高い順。`rounds/score-entry`)、エンドの小計 | なし |

枠の状態は、取得の結果で決まる。

| 状態 | 表示 | 判定 |
| :--- | :--- | :--- |
| 取得中 | 「一覧へ戻る」の行と読み込み中の表示 | 取得が完了していない(読み込みの開始から10秒まで) |
| 見つからない | 「ラウンドが見つかりません。」と「一覧へ戻る」リンク。存在しない・権限なし・論理削除済み・作成が破棄された・UUIDでないIDを区別しない | ラウンドが得られない |
| 端末のベースで表示 | ラウンドの内容(オンラインと同じ) | 通信できない(オフライン、取得の失敗、取得が1秒(`FALLBACK_WAIT_MS`)を超えた)とき、端末が保持するラウンドで、的の一覧の保存分がある |
| オフライン | 「ネットワークに接続されていません」と再試行 | `navigator.onLine`が`false`で、端末がオフラインで開けるベースか、的の一覧の保存分を持たないラウンド。ベースを持たないときの表示は`app/offline-pwa` |
| 取得エラー | エラーメッセージと再試行 | 取得がエラー。通信失敗は「読み込めませんでした。」(端末がオフラインで開けるベースを持たないラウンド)。的の一覧がそろわない(取得に失敗し、保存分も無い)ときも同じ |
| 取得中(的) | 読み込み中の表示。取得が完了すると内容を表示する | 作成が未確定のラウンドで、的の一覧の取得が完了していない(`rounds/setup`) |

- 点数の記録で、合計・小計・最高点数・X数は、保存(約10ms)の完了後に更新する。
- 入力中で距離がないラウンドでは、ラウンド編集ダイアログを開いた状態で表示する。
- 入力中のラウンドでは、矢数に達していない最初のエンドの新しい矢を指して、テンキーを展開する。全てのエンドが矢数に達していれば何も指さない。
- 完了のラウンドは、新しい矢を指さず、テンキーを展開せず、距離がなくてもラウンド編集ダイアログを開かない。
- Xのある的は「最高点数/X数」、ない的は「最高点数/次点数」を表示する。X数は`score_str`、その他は`score_int`から数える。
- ラウンド全体の最高点数・X数は、全距離でXの有無、最高点数、次の点数が一致するときだけ表示する。一致しなければ合計だけを表示する。

## 構成とデータの流れ

- `app/(main)/rounds/[id]/page.tsx`: 静的な枠の画面の入口。`generateStaticParams`で`/rounds/_`だけをプリレンダーし（`dynamicParams = false`）、取得も`cookies()`も使わない。`/rounds/<ID>`はnext.configのrewriteで`/rounds/_`の枠へ向ける。何も生成せず、`RoundDetailClient`を描くだけである。
- `features/rounds/ui/round-detail-client.tsx`: `usePathname()`のIDで取得し、状態に応じて枠の内表示かスコアカードを出す。列に削除があれば`RoundDetailStore.leaveRound`で一覧へ置き換えて遷移する(手続き`application/leave-round.ts`が`Navigation.replace(ROUNDS_PATH)`を呼ぶ)。的の一覧は読み込みの結果に含まれ、`ScorecardClient`へそのまま渡す。端末のベースで開いたラウンドが、取り直したサーバーに無いとき(削除済みなど)も`leaveRound`で移る。作成が確定せずに消えたら取り直す(`features/rounds/ui/use-creation-gone.ts`)。読み込みの全体を`withinFetchTimeout`で10秒に打ち切る(`app/offline-pwa`)。
- `features/rounds/domain/round-routes.ts`の`roundIdOfPath`: pathnameからUUIDを取り出す経路の持ち主の関数。UUIDでなければ`null`で、問い合わせずに見つからないとする。
- `features/rounds/infrastructure/round-queries.ts`、`features/rounds/application/fetch-round-detail.ts`: 問い合わせの組み立てと行の写しはインフラ層、取得の順序は手続きが持つ。ラウンド・距離・矢を1回のネスト取得、的を1回の取得で得て、`FetchResult`に分類する。的は自分の分と公式に絞る。対象ごとの`revision`(取り消した矢・無効化した距離を含む)も返す。的の取得(`fetchTargetFaces`)は、作成が未確定のラウンドの読み込みが使う。成功した一覧を端末に保存し(`features/rounds/infrastructure/reference-snapshot.ts`)、`ok`以外では保存済みを返す。保存済みがあるときの待ちは1秒で、時間切れの後に届いた結果は表示せず保存する。`fetchRoundDetail`は的を保存するが、代わりは持たず待ちは10秒のままである。一括の取得(`fetchRoundDetails`)も、的を保存する。
- `features/rounds/application/round-detail-store.ts`の`load`: 開く材料(ベースと的)を返す。サーバーの取得と端末の記録への反映は同期が行い(`refresh-round-bases.ts`の`refreshRound`)、`load`はその結果を待つ。列は記録のハブの`read`で読み、最初の読み込みで列に削除があれば、取得せずに削除済みを返す(作成が未確定でも同じ)。反映した組の列に削除があるときも、削除済みを返す。作成が未確定のラウンドは、ラウンドを取得せず、作成の操作を基準にする。通信できないときは、端末の組が保持の規則に当たれば、端末のベースで返す(`source`が`local`)。取得が`FALLBACK_WAIT_MS`を超えたときは、その完了を待たず、同期が取得を続けて結果を反映する。結果は常に、そろった的の一覧全体(取得に成功した一覧、または最後に取得に成功した一覧の保存分)を持つ。作成が未確定のラウンドは`fetchTargetFaces`で的を得る。端末のベースは的の保存分があるときだけ使い、無ければサーバーの取得を待つ。そろわなければ、取得の結果(`offline`か`error`)を返す。効かなかった操作または項目がある応答を受けたときの取り直しは、同期が決める(`features/round-sync/application/round-sync.ts`)。
- `features/rounds/domain/round-base.ts`、`features/rounds/application/refresh-round-bases.ts`: 端末に持つベースの規則と、入力中のラウンドの一括の取得(`rounds/sync`)。`features/rounds/domain/round-view.ts`の`deriveRoundState`は、端末の組から画面と同じ導出で状態を求める関数で、一覧も使う(`rounds/history`)。一括の取得の反映は、一覧も同じ経路(`refreshAll`)を使う。一括の取得は、`disabled_at is null`かつ`status = in_progress`、または端末にベースか操作があるラウンドを得て、ラウンドごとにベースを差し替える。端末のラウンドのIDは50件ごとの取得に分けて並行に得る(入力中の条件は最初の取得に含め、以降の取得は入力中を除く)。すべての取得が成功したときだけ成功とする。返らなかったラウンドは削除の印にする。
- `features/rounds/domain/round-tables.ts`、`features/rounds/domain/round-op-apply.ts`、`features/rounds/ui/use-round-op-stack.ts`: サーバーのテーブルの形のベース(`RoundTables`)、操作の列を重ねる導出(RPCごとの処理)、画面の状態を導く`selectRoundState`と、`RoundDetailStore`の`round(...)`(`features/rounds/application/round-handle.ts`が返す購読と追記の入口)を購読するフック。完了のラウンドの編集で入力中へ戻す操作は、手続き`features/rounds/application/edit-round.ts`が積む(窓口の`handle.append`が今の状態の読み手を渡して呼ぶ。`rounds/completion`)。画面の状態は、端末の記録のベースと操作の列から求める。`use-scorecard.ts`は`state`(保存が完了した操作から導いた値)を`useRoundOpStack`から受ける。
- `features/round-sync/application/round-sync.ts`: 端末のベースで開いたときの取り直し。取得の完了、`online`、見える状態になったとき、既存の`retryDelayMs`(3秒から2倍で60秒まで)の間隔で取り直す(`navigator.onLine`が`true`のまま通信が戻る場合のため)。`offline`で止め、`online`で最初の間隔から始め直す。
- `features/rounds/ui/round-detail-frame.tsx`、`back-to-list-link.tsx`: 枠と「一覧へ戻る」リンク(`ROUNDS_PATH`を使う)。
- `features/rounds/ui/scorecard-client.tsx`（Client Component）: スコアカードの枠を組み立てる。
- `features/rounds/ui/use-scorecard.ts`: `state`(保存が完了した操作から導いた`shots`と距離の構成)を`useRoundOpStack`から受け、画面のフック(指している矢、テンキー、取り消しの列、距離の編集)を束ねる。
- `features/rounds/ui/scorecard-header-bar.tsx`、`round-config-card.tsx`、`round-summary-bar.tsx`: ヘッダーの帯(領域の外)、ラウンドの設定のカード、合計の帯(領域の中)。
- `features/rounds/ui/distance-section.tsx`: 距離ごとのカード(見出し、編集、小計、エンドの行)。
- `features/rounds/domain/scorecard-scoring.ts`: 距離とラウンドの集計、エンドの小計を求める純粋関数。

## 対応表

詳細の画面の部品の置き場である。`app/(main)/rounds/[id]/`には`page.tsx`と`page.test.tsx`だけが残る。

| ファイル | 用語 |
| :--- | :--- |
| `app/(main)/rounds/[id]/page.tsx` | 画面の入口(サーバー専用の宣言を持ち、クライアントの部品を描くだけ) |
| `app/root-client-entry.tsx` | アプリの起動地点(完了と保存の手続きと遷移の`replace`を生成する) |
| `features/rounds/ui/round-detail-client.tsx`、`round-detail-frame.tsx`、`back-to-list-link.tsx` | UI層(取得の表示の切り替え、取得中などの枠、一覧へ戻るリンク) |
| `features/rounds/ui/scorecard-client.tsx`、`scorecard-header-bar.tsx`、`round-config-card.tsx`、`round-summary-bar.tsx` | UI層(スコアカードの組み立て、上端の帯、設定のカード、合計の帯) |
| `features/rounds/ui/round-config-panel.tsx`、`round-menu.tsx`、`save-preset-dialog.tsx`、`save-preset-dialog-state.ts` | UI層(設定のパネルと編集のダイアログ、メニューと削除の確認、保存のダイアログの描画と状態) |
| `features/rounds/ui/distance-section.tsx`、`distance-edit-fields.tsx`、`target-face-picker.tsx`、`end-row.tsx` | UI層(距離のカード、距離の編集フォーム、的の選択、エンドの行) |
| `features/rounds/ui/keypad-buttons.tsx`、`keypad-panel.tsx`、`bottom-frame.tsx`、`complete-round-bar.tsx` | UI層(テンキー、横向きのパネル、縦向きの下端の枠、完了の帯と確認) |
| `features/rounds/ui/use-scorecard.ts`、`use-round-op-stack.ts`、`use-score-history.ts`、`use-shot-input.ts`、`use-pending-shots.ts`、`use-reconciled-pointer.ts`、`use-distance-editing.ts`、`use-keypad.ts`、`use-reorder-animation.ts`、`use-creation-gone.ts`、`scroll-to-pointer.ts` | UI層(画面の状態と操作) |
| `features/rounds/ui/color-tone.ts` | UI層(16進の色から文字色と薄い色を求める計算。使い手はラウンドの機能だけ) |
| `features/rounds/domain/shot-pointer.ts`、`score-history.ts`、`shot-operations.ts` | ドメイン層(指している矢の遷移、取り消しの列、矢の操作の組み立て) |
| `features/rounds/domain/round-progress.ts` | ドメイン層(完了の確認、状態を変える操作、入力中へ戻すかの判定`reopeningRequired`、削除の操作) |
| `features/rounds/application/edit-round.ts` | 手続き(追記。完了のラウンドの編集で、続けて入力中へ戻す操作を積む) |
| `features/rounds/domain/distance-config.ts`、`distance-operations.ts`、`target-face-filter.ts`、`position-key.ts` | ドメイン層(距離の設定の検証、距離の操作、的の絞り込み、位置キー) |
| `features/rounds/domain/preset-save.ts`、`ring-color.ts`、`shot-id.ts`、`round-routes.ts`、`write-result.ts` | ドメイン層(保存するプリセットの内容、リング色、時刻順の矢のID、経路、書き込みの文言) |
| `features/rounds/application/leave-round.ts`、`save-preset.ts` | 手続き(完了、削除、削除して離れる、一覧へ戻る。プリセットの保存) |
| `features/rounds/application/navigation.ts`、`preset-commands.ts`、`unique-ids.ts` | 手続きの約束(`Navigation`、`PresetCommands`、`UniqueIds`) |
| `features/rounds/application/round-detail-store.ts`、`round-handle.ts` | 手続き(詳細の画面に渡す状態と変更の方法、開いた詳細の購読の状態) |
| `features/rounds/infrastructure/router-navigation.ts`、`preset-commands.ts`、`browser-unique-ids.ts`、`rounds-db-schema.ts` | インフラ層(遷移、保存の書き込み、乱数の払い出し、保存の関数) |

集計は、点数を入力するたびにクライアントで再計算し、サーバーへ問い合わせない。
取得の結果は`ScorecardClient`へ渡し、以降の更新は楽観的UIと操作の列で行って、再取得を待たない。
ベースと操作の列は組として持ち、列を`seq`順に`applyOperations`でベースへ重ね、`selectRoundState`で画面の状態にする。読み込み時と操作時で同じ関数を使う。確定した操作は、ベースの`revision`が確定した`revision`以上なら列から外れる(`rounds/sync`)。重ね合わせは冪等で、二重の適用は結果を変えない。
`data-hydrated`はスコアカードの根にだけ付け、E2Eはこれを待つ。
静的化は、`next build`の出力が`● /rounds/[id]`・`└ /rounds/_`になり、`.next/server/app/rounds/_.html`にユーザー・ラウンドのデータが含まれないことで確かめる。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| 入力と表示を`/rounds/[id]`の1画面にまとめ、独立した集計画面を設けない | 入力後も同じ画面で内訳を確認できるようにするため | 集計だけを見る用途が増えたとき |
| 一覧へ戻る行（`h-14`）と完了の帯はスクロール領域の外に置き、ラウンドの結果（`top-0`）と距離の結果（`top-8`）は領域の中でstickyにして重ねずに並べる | 長いスコアカードでも合計を見られるようにするため。結果の帯は設定のカードと結合した見た目、距離の結果は距離ごとの範囲で固定されるため、領域の外へ出さない | 固定要素の高さを変えるとき(領域の中の固定表示は`data-sticky-inset`を付ければ指す矢への追従が見込む) |
| 最高点数・X数を、的のリング構成から動的に求め、Xのない的は最高点数と次の点数を表示する | 6点的やコンパウンドの40cm的など、標準の10点的以外にも対応するため。Xの有無を固定とした集計は採らない。詳細: #418 | 的の種類を増やすとき |
| 表示の順を「最高点数/X数」にし、X数は`score_str`で数える | Xのない的でも最高点数が先頭にあるほうが読みやすいため、「X数/最高点数」の順をやめた。`score_int`だけではXと10を区別できない | 最高点数とX数の並びを利用者が選べるようにするとき |
| ラウンド全体の最高点数・X数は、全距離で一致するときだけ表示する | 的が異なる距離を足した最高点数・X数は意味を持たないため | 的が異なる距離の集計を定義するとき |
| 印の無い距離（フィールド）は、的に存在しない点数を数えない | フィールド的に10点・Xなどがないため | フィールド的に10点・Xなどの点数を設けるとき |
| ページを静的な枠にし、ラウンドをクライアントで取得する。更新は楽観的UIと操作の列で行う | オフラインでも枠を出し、取得の失敗を枠内で区別するため。書き込みの完了を待たずに反映するため。詳細は`rounds/sync`、#648 | 取得をサーバーで行う必要が出たとき |
| `generateStaticParams`で`[{ id: "_" }]`だけを返し、`dynamicParams = false`にする | `/rounds/<ID>`はnext.configのrewriteで`/rounds/_`へ向くため未知のIDは動的ルートに届かず、IDごとのHTMLが永続化され続けるのを防ぐ。オンラインの未知のIDも枠が返り、見つからないは枠内に出す | rewriteをやめるとき |
| `data-hydrated`を枠の状態に付けず、取得後のスコアカードにだけ付ける | 枠に付けると、E2Eの待ちが取得の完了より先に解け、状態を前提にする操作が競合するため | E2Eの待ちの方式を変えるとき |
| 表示の規則(入力中と見せる)と保持の規則(オフラインで開ける)を分ける | 未送信の操作が残る完了のラウンドのように、入力中と見せずに保持するラウンドがあるため。表示は状態だけで決め、保持は状態とベースに反映されていない操作で決める | 保持と表示を同じ規則にしたいとき |
| 一括の取得の対象を、入力中のラウンドと、端末に保持するラウンドにする。契機は、認証イベント(`INITIAL_SESSION`・`SIGNED_IN`でセッションがあるとき)、`online`、見える状態になったときで、時間の値は使わない | 他端末で作成し記録したラウンドを、この端末で一度も開かなくても、オフラインで開けるようにするため。完了で送信済みのラウンドは対象にしないため、端末の保存量が入力中の数で抑えられる | 放置された入力中のラウンドの保持の上限が要るとき |
| 一括の取得で、端末のラウンドのIDを50件ごとの取得に分け、どれかが失敗すれば全体を失敗とする | IDはGETのURLに載るため、全件を1回に並べると保持の件数に比例して伸び、ゲートウェイが414で拒むため。一部の成功を反映すると、返らなかった保持のラウンドが削除の印になるため。POSTのRPCへ移す案は、ネスト取得と認可をDBの関数で作り直す必要があるため採らない | 保持の件数に上限を設けるとき、またはゲートウェイのURL長の上限が分かったとき |
| 的の一覧がそろうまで、ラウンドの内容を出さない。そろうとは、取得に成功した一覧か、最後に取得に成功した一覧の保存分があることとする | 的の無い間は、テンキーがMだけ、玉がMの色になり、未確定の操作も的で判定できない。このため、内容を先に出して的を背景で取得するのをやめた。的は配布でしか変わらないため、件数や版で最新性を確かめない | 利用者が的を作れるようにするとき |
| 完了、削除、一覧へ戻る遷移を手続きの約束(`Navigation`)で表し、窓口に持たせる | 保存の後に進む順序を手続きに置き、画面が遷移の実装を持たないため(L01、R01) | 画面ごとに異なる遷移の方法が要るとき |
| IDの払い出しを窓口(`newId`、`newShotId`)から受ける | 乱数と時刻を画面が直接読まず、手続きが約束から読むため(X01、R01)。操作の組み立てを全て手続きへ移す案は、`SyncOperation`(同期の契約の型。`eventId`が必須)のほかに下書きの型を足し、同じ操作を表す型が2つになるため採らない | 操作の組み立てを手続きへ移すとき |
| 導出の初期値を取得の中で求め、`ScorecardClient`のマウント後には行わない | サーバーの値が一瞬見えるちらつきを避け、最初に指す新しい矢が未送信の矢を含む状態で決まるようにするため | 取得と重ね合わせを分ける必要が出たとき |

## 制約と未対応

- 画面を開いていない間(印を付ける前、外した後)の追記では、入力中へ戻す操作を積まない。画面の部品は印を付けた後にだけ操作するため、実際には起きない。
- ラウンドの結果の最高点数・X数は、的が異なる距離を含むラウンドでは表示しない。
- オフラインのときは、端末が保持するラウンド(状態が入力中か、ベースに反映されていない操作が残るもの)だけが開ける。保持しないラウンドは取得できず、未送信の操作の楽観値も表示されない(的の一覧の保存分がある、作成が未確定のラウンドを除く)。オンライン復帰（`online`イベント）で自動再取得され、操作の列が重ねられて表示される。
- 最後の取得の後に他端末で削除・完了・記録されたラウンドは、オフラインの間は取得時点の状態で表示する(古さの注意書きは出さない)。取得時点のベースに未送信の操作を重ねる。
- 最後に取得に成功した後に配布で追加された的は、取得できるまで、保存分で開いた詳細の一覧に無い。距離がその的を参照するときは、その距離に「的データを取得できません」を出し、キーはMだけになる。
