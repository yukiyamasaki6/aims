# rounds/delete 設計

## 概要

ラウンドの削除は、ホームと履歴の各カードのメニューと、ラウンド詳細画面のヘッダーのメニューから行う。
どちらも確認ダイアログを経て、確認と同時に操作の列（`rounds/sync`）へ`round.disabled`を積み、画面から除く。
送信は常駐の送信器が行い、オフラインでも削除できる。復帰後に`disable_round` RPCが送られる。

## 画面と状態

| 状態 | 表示 | 次の状態 |
| :--- | :--- | :--- |
| メニュー閉 | 一覧はカードごと、詳細はヘッダーにメニューボタン | メニューボタンで展開 |
| メニュー展開 | 一覧は「削除」、詳細は「ラウンドを削除」 | 削除ボタンで確認中、外側クリックで閉じる |
| 確認中 | 説明文とキャンセル・確認ボタン | キャンセル・背景クリック・Escで閉じる、確認ボタンで閉じて削除済み |
| 削除済み | 一覧はカードが消え、詳細は枠の中の見つからない表示になる | - |

- 確認文言は、一覧ではラウンド名を含み、詳細では含まない。一覧でも名前の無いラウンドは名前を含めず、詳細と同じ文言にする（メニューボタンの読み上げ名も「ラウンドのメニュー」）。どちらも、記録したスコアがすべて失われることを明示する。
- 確認後の画面更新は画面ごとに異なる。一覧は削除済みの集合へ足してカードを除き、詳細は列への保存の後に`/rounds`へ`replace`で遷移する（戻るボタンで削除したラウンドの詳細へ戻らない）。

## 構成とデータの流れ

- `apps/web/src/features/rounds/ui/round-cards.tsx`、`round-delete.tsx`: ホームと履歴のカードのメニューと、削除済みの集合によるカードの除去、確認ダイアログ。
- `features/rounds/ui/round-menu.tsx`: 詳細のヘッダーのメニュー。確認で手続きの入れ物の`leaving.deleteRoundAndLeave`を呼ぶ(追記の直後に画面の状態は削除済みへ変わり、保存の完了の後、画面が残っている(`isCurrent`、`useMountedRef`)ときだけ遷移元(`useRoundOrigin()`の値。履歴から開いたときは履歴、それ以外はホーム)へ置き換えて遷移する。保存が詰まる間は詳細に留まる)。
- 手続きの入れ物の`deletion.deleteRound`(ホームと履歴): 手続き`features/rounds/application/round-deletion.ts`の`RoundDeletion.deleteRound`(離れない削除)を、ホームと履歴の画面が手続きの入れ物から直接受けて呼ぶ。手続きが`round.disabled`(操作の組み立ては`features/rounds/domain/round-progress.ts`の`roundDisabledOperation`)を新しい`eventId`(約束`UniqueIds`、実装は`features/rounds/infrastructure/browser-unique-ids.ts`)で列へ追記する。保存の試みの完了で解決し、拒否しない。
- `components/ui/confirm-dialog.tsx`の`ConfirmDialog`: 確認後すぐ閉じる。
- `apps/web/src/features/rounds/domain/rounds-list-view.ts`: 履歴の取得結果から、列で削除済みのラウンドを除く（`rounds/history`）。端末の入力中のラウンドは、削除済みを入れずに求める。
- `features/rounds/application/round-window.ts`の詳細の購読: 列に削除があれば(購読の最初の判定)、取得せずに見つからないにする（`rounds/detail`）。

流れは、メニューから確認ダイアログを開き、確認で、一覧は手続きの入れ物の`deletion.deleteRound`、詳細は手続きの入れ物の`leaving.deleteRoundAndLeave`を呼ぶ(詳細の手続き`round-leaving.ts`は、一覧と同じ`round-deletion.ts`の`deleteRound`の完了の後に遷移する)。
ホームと履歴は、そのラウンドを削除済みの集合へ足して除く。詳細は、手続きの入れ物の`leaving.deleteRoundAndLeave`(手続き`features/rounds/application/round-leaving.ts`が`round-deletion.ts`の削除の保存の完了の後、`isCurrent`が真のときだけ`PageNavigation.replace(originPathOf(origin))`を呼ぶ。離れていれば遷移しない)で遷移元へ置き換える。
送信は常駐の送信器が行い、画面が閉じても続く。未確定の作成のラウンドは、既存の衝突規則で作成の確定を待って削除が送られる。
認可の拒否と契約の不一致は破棄され、履歴を取得し直すと(入力中のラウンドは同期の後に)ラウンドが再表示される。

`disable_round`（`SECURITY DEFINER`、`authenticated`にのみEXECUTEを付与）の契約は次のとおり。
- 認可: 対象ラウンドを行ロックし、呼び出し元が`round_users.role = 'editor'`でなければ`PT403`で拒否する。
- 冪等性: `event_id`が既に`round_events`にあれば何もしない(既存の`revision`を返す)。削除済みのラウンドへの別の`event_id`の削除は、書かずに効かない結果(`DISABLED`)で返す。
- 戻り値: 他の書き込みRPCと同じ`{revision, applied, reason}`のjsonb。
- 副作用: `DISABLED`イベントを追記し、`rounds.disabled_at`を設定して`revision`を進める。
- 削除の前後に届いた距離・矢の操作は、サーバーで効かず、表示されない。
- 論理削除であり、距離・矢の行は残る。履歴と詳細は`disabled_at is null`で絞るため、削除したラウンドはホームにも履歴にも出ず、詳細は「見つかりません」になる。
- クライアントからの直接のDELETEは、RLSで拒否する。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| 確認後すぐ閉じる`ConfirmDialog`で、操作の列へ積む | オフラインでも削除でき、確認後に待たせないため。失敗は再表示で足りる。詳細: #393 | 削除の取り消しや失敗の通知を求めるとき |
| プリセット削除は、削除側のフックが実行中を持つ`BlockingConfirmDialog`のまま(サインアウトも同じダイアログを使う) | オフライン対応が不要で、失敗をダイアログ内に示して再試行させるため。実行中とエラーは呼び出し側が持つ | プリセット削除をオフラインで認めるとき |
| 削除を、`disabled_at`による論理削除にする | 追記専用のイベントログと射影を用いるため。再送しても二重に適用されない | 保持期間や物理削除の運用を決めるとき |
| 認可を、RPC内の`round_users.role = 'editor'`の確認で行う | 書き込みを権限確認するRPCの境界へ統一したため。クライアントのセッション確認は予防にすぎず、入口が渡す`SessionReader`の`readSession`で未認証と不明（通信失敗）を区別し（ラウンド削除とプリセット削除で同じ判定）、`getUser()`でなく`getSession()`を使う | 認可の方式を変えるとき |
| 詳細のメニューを、`RoundConfigPanel`でなくページのヘッダーに置く | 将来の印刷・共有などラウンド全体の操作の置き場も兼ねるため | ラウンド全体の操作を別の場所へ集めるとき |
| 操作の組み立て(`roundDisabledOperation`)を共通にし、一覧は`deletion.deleteRound`、詳細は`leaving.deleteRoundAndLeave`を呼ぶ。画面からの除去は各画面が行う | 一覧と詳細で処理が重複していたため | 画面ごとの成功後の処理が揃うとき |

## 制約と未対応

- 編集権限のないメンバー（`viewer`）にも削除メニューを表示する。実行するとカードは消え、サーバーが拒否して破棄するため、履歴を取得し直すと通知なく再表示される。
- 別のタブで行った削除は、開いているホームや履歴には反映されず、再読み込みで反映される。破棄された削除は、記録から外れて次に履歴の材料を読むときに反映される。
- 未認証のときの削除は、列に保留され、同じユーザーのサインインで送られる。
- 削除したラウンドを元に戻す機能はない。論理削除した行の保持期間は決めていない。
