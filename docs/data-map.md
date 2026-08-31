# Data Map (データ配置図)

画面ごとの詳細・実装状況はfeature-map.mdを参照。
データの関係性はerd.mdを参照。
アクセス制御はsecurity.mdを参照。

| 画面 | 操作 | テーブル |
| :--- | :--- | :--- |
| `/signup` | `auth.users`へのinsertトリガーで`public.users`を1:1作成 | `users` |
| `/rounds` | 自分が属する`round_users`経由で`rounds`を絞り込み、各ラウンドの合計点等を集計して表示 | `round_users`, `rounds`, `distances`, `shots` |
| `/rounds/new` | 作成者を`round_users`に`editor`として登録 → `rounds`を作成 → 距離構成ごとに`distances`を作成 | `round_users`, `rounds`, `distances` |
| `/rounds/[id]`（初期表示） | `rounds`・`distances`・`shots`を結合取得し、合計・X数などをクライアント側の純粋関数で算出。的選択用に`target_faces`（`target_face_spots`, `target_face_rings`込み）も取得 | `rounds`, `distances`, `shots`, `target_faces` |
| `/rounds/[id]`（距離追加） | 直前の距離の設定を引き継いで`distances`に1件追加 | `distances` |
| `/rounds/[id]`（距離編集） | 距離・的選択等を更新。`shots`が存在する距離は総エンド数・エンドあたりの本数・的を変更不可 | `distances` |
| `/rounds/[id]`（距離削除） | `distances`を削除（`shots.distance_id`の`on delete cascade`で該当`shots`も連動削除） | `distances` |
| `/rounds/[id]`（点数入力） | エンド・矢番号ごとに`shots`をupsert | `shots` |
| `/rounds/[id]`（点数取消） | 該当`shots`を削除 | `shots` |
| `/rounds/[id]`（ラウンド設定更新） | ラウンド名・実施日・種別・弓種を`rounds`に反映 | `rounds` |
