# rounds/start 設計

## 概要

`/rounds/new`は、個人プリセットと公式プリセットの一覧から選ぶか、選ばずに、ラウンドを作成して`/rounds/[id]`へ遷移する入口である。
ラウンド名・実施日・種別・弓種・距離構成の入力は持たず、作成後に`/rounds/[id]`で編集する。
プリセットなしで始めると、距離を持たない空のラウンドを作る。
作成を端末の操作の列へ積み、保存の完了後に遷移する。送信は常駐の送信（`rounds/sync`）が行う。
画面の枠は静的で、プリセットはクライアントが取得する。開始ボタンは取得に依存しない。
取得できたプリセットを端末に保存する。保存済みがあれば取得を待たずに先に表示し、取得できたら置き換える。取得できないときは保存済みを表示し続ける。

## 画面と状態

| 状態 | 表示 | 判定 |
| :--- | :--- | :--- |
| 取得中 | 一覧の領域に読み込み中の表示を出す。枠と開始ボタンは使える | 取得が完了していない |
| 一覧 | 個人プリセットと公式プリセットを分けて並べる。公式にはメニューボタンを出さない | 取得結果が個人・公式を含む |
| 個人プリセットなし | 個人プリセット欄にプレースホルダー | 個人が0件 |
| 保存済み | 保存済みの一覧を出す。個人・公式の分け方と選択は取得結果と同じ | 保存済みがあり、取得が終わっていない、または失敗した |
| オフライン（保存済みなし） | 一覧の領域に「ネットワークに接続されていません」と再試行を出す（`app/offline-pwa`）。枠と開始ボタンは使える | `navigator.onLine`が`false`で保存済みが無い |
| 取得エラー（保存済みなし） | 一覧の領域にエラーメッセージと再試行を出す。枠と開始ボタンは使える | 取得がエラーで保存済みが無い。通信失敗は「読み込めませんでした。」 |
| 未選択 | 開始ボタンに「プリセット無しで開始」 | `selectedId`が`null` |
| 選択中 | 選択カードに距離構成を展開し、開始ボタンにプリセット名を出す | `selectedId`が一覧のIDに一致 |
| 未選択へ戻る | 選択中のカードか展開領域をクリックすると未選択に戻る | 同上 |
| 保存中 | 開始ボタン(`BusyButton`)にスピナーを出し`aria-disabled`にする。保存後も遷移完了まで解除しない | `submitting`が`true` |
| 開始失敗 | 開始ボタンの上に「サインインが必要です。」を出し、再び押せる | 未認証が確認された（`unauthenticated`が真） |

- 「一覧へ戻る」は通常のリンクである。
- 未認証のアクセスは`proxy.ts`が`/signin`へ送る。

## 構成とデータの流れ

- `app/(main)/rounds/new/page.tsx`: 入口。何も生成せず、`RoundPresetSelect`を描くだけである。
- `features/rounds/ui/round-preset-select.tsx`: UI層。取得と選択の状態を持ち、一覧、開始の帯、削除の確認を描く。手続きの入れ物(`RoundProcedures`)を文脈で受け取り、`fetching.fetchPresets()`で一覧を得て、`whenOnline`で通信の復帰を受ける。「一覧へ戻る」は`ROUNDS_PATH`を使う。削除の部品は`rounds/preset`が扱う。
- `features/rounds/ui/use-start-round.ts`: UI層。作成中と未認証の状態を持ち、実行中は2回目の開始を無視して、手続きの入れ物の`roundStart.startRound`を呼ぶ。失敗は一様に実行中を戻し、未認証のときだけ未認証の表示を立てる。画面を離れた（`left`）ときの状態の更新は、離れた画面に見えない。
- `features/rounds/ui/preset-info.tsx`、`target-face-info.tsx`: UI層。プリセットと距離、的の情報の表示。
- `features/rounds/application/round-fetching.ts`の`RoundFetching.fetchPresets`(手続きの入れ物の`fetching`): 取得の順序(手続き)。取得の結果だけを返し、成功した結果を取得に使った利用者のキーへ保存する。保存済みは`savedPresets`が返し、画面が先に出す(`withSaved`)。
- `features/rounds/infrastructure/round-queries.ts`の`RoundQueries.presets`: 個人（`owner_id`が自分）と公式（`owner_id`が`null`）を1回の取得で得る。`DatabaseGateway`の`select`で行い、`QueryOutcome`(`domain/query-outcome.ts`)を返す。応答を種類へ写すのはインフラ層の`db-response-outcome.ts`である。
- `features/rounds/domain/preset.ts`: ドメイン層。プリセットの値、並びの比較`comparePresets`、並べて個人と公式に振り分ける`presetsOf`、距離の並び、個人プリセットの除去。
- `features/rounds/domain/preset-list-view.ts`: ドメイン層。取得結果から、削除済みを除いた表示と選択中のプリセットを決める`presetListView`。
- `features/rounds/infrastructure/reference-snapshot.ts`: 参照データ（プリセット、的）をユーザーごとのキー`aims:reference:<種類>:<ユーザーID>`で`localStorage`へ保存・読み出しする。値は`{shape, startedAt, data}`で、`shape`は取得のselect文字列、`startedAt`は取得の開始時刻。読み出しは`shape`だけを照合する。保存先が使えない・満杯の環境と、この実装以外が書いた壊れた値は想定外とし、そのとき投げる。識別情報は入口から`IdentityReader`で受け取り、読むたびにその時点で読む。
- 開始の手続き(手続きの入れ物の`roundStart`。`features/rounds/application/round-start.ts`): サインインの状態の確認、選択中プリセットからの作成の操作の組み立て(`features/rounds/domain/round-start.ts`の`roundCreatedDraftOf`がIDを除いた内容を作り、手続きが各要素にIDを振る)、`round.created`の追記を行う。実施日の初期値は、開始時の`Clock`の時差(`utcOffsetMinutes`)を足した端末のローカルの日付で、domainは環境のタイムゾーンに触れない。追記の完了の後に、共有の技術の約束`PageNavigation`(`go(path)`)で`roundPath(roundId)`へ進む。実装は`lib/page-navigation/infrastructure/router-page-navigation.ts`で、入口が画面のパッケージの遷移の部品から生成する。

- 並びは、種別、弓種、距離の本数（多い方が先）、先頭の距離（大きい方が先）、作成日時（新しい方が先）の順である。
- 開始は一覧の取得結果の構成で作る。一覧の表示後に削除されたプリセットでも、表示していた構成で開始する。
- ラウンドと距離のIDはクライアントで生成して渡す。
- 送信される`create_round`は、`round_users`・`rounds`・`distances`を1トランザクションで作る。`rounds`の直接INSERTはRLSで拒否する。
- 画面がアンマウントされた後は、サインインの確認の待ちの後に、追記も遷移もしない（手続きが呼び出し側の`isCurrent`で守り、`failed`の`left`で返す）。追記の保存の待ちの後に離れたときは、追記は済んでいるため`created`を返し、遷移だけしない。

## ファイルと層

| ファイル | 層 |
| :--- | :--- |
| `app/(main)/rounds/new/page.tsx` | 入口 |
| `app/root-client-entry.tsx` | 入口(開始と削除の手続き、遷移、プリセットの書き込みを生成する) |
| `features/rounds/ui/round-preset-select.tsx`、`preset-list.tsx` | ui(作成の画面の組み立てと、開始と削除。プリセット一覧の描画) |
| `features/rounds/ui/use-start-round.ts` | ui(開始の実行中とエラーの状態、二重の開始の防止) |
| `features/rounds/ui/use-preset-delete.ts` | ui(確認中のプリセット、削除済みのID、実行中とエラーの状態) |
| `features/rounds/ui/preset-info.tsx`、`target-face-info.tsx` | ui(プリセットと距離、的の情報の表示) |
| `features/rounds/domain/preset.ts` | domain(プリセットの型、距離の並び、プリセットの並びと振り分け、除去) |
| `features/rounds/domain/preset-list-view.ts` | domain(取得結果からの表示の内容の決定) |
| `features/rounds/domain/round-start.ts` | domain(プリセットの構成からの、IDを除いたラウンドの作成の内容の組み立て) |
| `features/rounds/domain/write-result.ts` | domain(書き込みの結果(成功か失敗)と、保存と削除の失敗の種類) |
| `features/rounds/domain/option-label.ts` | domain(選択肢の値の表示名`labelOf`) |
| `features/rounds/domain/target-face.ts` | domain(的を引く`lookupTargetFace`を持つ) |
| `features/rounds/application/round-start.ts` | application(開始) |
| `features/rounds/application/preset-deletion.ts` | application(個人プリセットの削除) |
| `features/rounds/application/preset-commands.ts` | application(約束`PresetCommands`) |
| `features/rounds/application/reference-snapshots.ts`、`unique-ids.ts` | application(約束`ReferenceSnapshots`、`UniqueIds`)。サインインの状態は、認証の入口の`SessionReader`を型だけで受ける |
| `features/rounds/application/round-fetching.ts` | application(取得の順序。プリセットの取得を持つ)と約束(`RoundQueries`) |
| `features/rounds/infrastructure/preset-commands.ts` | infrastructure(プリセットの書き込みと、結果の種類への写し) |
| `features/rounds/infrastructure/browser-unique-ids.ts` | infrastructure(新しいIDの払い出し) |
| `features/rounds/infrastructure/round-queries.ts`、`reference-snapshot.ts`、`rounds-db-schema.ts` | infrastructure(プリセットの問い合わせ、保存済みの書き換え、プリセットの表を持つ) |
| `hooks/use-mounted-ref.ts`(アンマウント後を表す。Strict Modeの開発時の二重実行は保証対象外)、`hooks/use-hydrated.ts`、`components/ui/{busy-button,button,confirm-dialog}.tsx` | 共有の画面部品 |
| `lib/supabase/contract/database.ts`、`lib/supabase/infrastructure/database.ts` | `lib/<能力>`(約束と実装: 削除`delete`を持つ) |

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| 入口を選択だけにし、入力は`/rounds/[id]`の編集に一本化する | 入力の重複を持たないため | 作成時に入力が必要な要求が出たとき |
| 作成は`create_round`に一本化する | `INSERT ... RETURNING`は、同一文内のトリガー副作用をSELECTポリシーが参照できず失敗するため。詳細: #99 | RLSの評価方式が変わったとき |
| サーバーの完了を待たず操作の列に積む | オフラインでも開始し記録を失わないため。Server Actionは`redirect()`の競合のためやめた | - |
| 成功後も開始ボタンを無効のままにする | 開始の手続きが遷移を進め、遷移先の取得中も本コンポーネントが残るため、解除すると遷移前に再び押せるため | 遷移方式を変えたとき |
| 個人と公式を1回の取得で得て、`owner_id`を自分か`null`に絞る | 失敗の分類を1系統にするため。`preset_rounds`のRLSは認証済みの全員に全行を見せ、絞らないと他人の個人プリセットが返るため | RLSで個人プリセットを所有者だけに絞るとき |
| 開始ボタンを取得に依存させず、取得中も押せる | 取得が遅い・失敗する状況でも、唯一の操作を遅らせないため。取得結果が無ければ未選択なので、誤ったプリセットで作らない | 取得を待つ必要がある入力を開始前に加えるとき |
| 保存済みをユーザーごとのキーで`localStorage`に持ち、保存済みを先に出し、取得できたら置き換える。失敗・オフラインでは保存済みを残す | オフラインで開始でき、遅い通信でも待たず、古い一覧を見続けないため。選択中のプリセットは、置き換えの後も、あれば選択のまま、無ければ未選択に戻る。SWの実行時キャッシュはクロスオリジンを通さず認証に依存するため採らない | 保存量が`localStorage`の容量に近づいたとき。 |
| 保存のキーは取得の開始時のクエリのユーザーIDにし、取得の開始時刻が新しいときだけ書く | 遅れて届いた結果や、サインインし直しの前後で、別のユーザーのキーへ書かず、古い結果で新しい保存済みを戻さないため | - |
| プリセットをラウンドの機能の中に置く | プリセットを使う画面はどれもラウンドの画面で、構成と一緒に変わり、別の機能にすると開始と保存で機能の間が循環するため(R4) | ラウンドの画面の外でプリセットを扱うとき |
| 開始の後の遷移を共有の技術の約束(`PageNavigation`。`lib/page-navigation/contract/page-navigation.ts`)で表し、取得と削除と開始は、窓口を介さず手続きの入れ物から画面が直接受ける。約束の使い手は開始と、詳細の完了、削除して離れる、一覧へ戻るである | 保存の後に進む順序を手続きに置き、画面に渡す形を1つにするため(R3) | 画面ごとに異なる遷移の方法が要るとき |
| 実施日の初期値は端末のローカルの日付で、時差を`Clock`から受ける | 利用者が見る日付と一致させ、domainを環境に依存させないため | 実施日をサーバーの時刻で決めるとき |
| 並びを名前でなく構成で決める | 名前は自由入力で内容を反映せず、自然順ソートは漢字の読みで曖昧になるため | プリセットの種類が増えたとき |
| クライアントの認証確認は入口が渡す`SessionReader`の`readSession`で判定し、未認証と確定したときだけ止めて、失敗の種類`unauthenticated`(文言は「サインインが必要です。」)を返す。不明（通信失敗）と`FALLBACK_WAIT_MS`（1秒。代わりがある待ちの上限、`app/offline-pwa`）の時間切れは開始する | `getUser()`はサーバー再検証を伴い、認可の実体はRPCにあるため。オフラインで開始でき、未認証の確認を保つため。待つのはトークンの失効時だけ | 開始の待ちが知覚されたとき |

## 制約と未対応

- オフライン表示のときは、通信の復帰（手続きの入れ物の`whenOnline`）で自動再取得する。通信失敗（`navigator.onLine`が`true`のまま）を含むエラーは、再試行ボタンで取得し直す。
- 一度もオンラインで表示していない端末ではオフラインで使えない（的の一覧は、オンラインでラウンド詳細を開いたときと、サインインしている間の一括の取得(`rounds/sync`)で保存される）。
- 的の一覧を保存していない端末で、通信できないまま開始したラウンドの詳細は、ラウンドの内容を出さず、オフラインまたはエラーの表示にする(`rounds/detail`)。
- オフラインで保存済みを表示している間は、通信の復帰で自動再取得し、取得できたら置き換える。エラーのときは自動再取得しない。
- `main`の`data-hydrated`を、E2Eがハイドレーションを待つ目印に使う。
