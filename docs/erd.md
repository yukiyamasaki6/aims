# Entity Relationship Diagram (実体関連図)

> **未実装**：3種類のイベントテーブル、サーバー生成の`revision`、`disabled_at`、イベントの受信・射影・永続化。

| テーブル名                  | 説明                                                                             |
| :------------------------ | :------------------------------------------------------------------------------ |
| `users`                   | ユーザーの基本プロフィール情報を保持する。 |
| `rounds`                  | アーチェリーの記録単位となる「ラウンド」（1回の練習・試合セッション）を表す。距離構成は`distances`が持つ |
| `round_users`             | 特定のラウンドに対するユーザーのアクセス権限・ロールを管理する多対多の中間テーブル。1ラウンドに複数のeditor/viewerが存在しうる |
| `distances`               | ラウンド中に射撃する特定の距離（70m、50m等）を表す。1ラウンドに複数の距離を持てる            |
| `shots`                   | 個々の矢のスコアと、誰が射ったかを記録する。1つの(距離, エンド, 矢番号)は常に1本の矢を指す      |
| `round_events` | `rounds`への変更を表す追記専用イベントログ。書き込みの正。削除・修正は行わない          |
| `distance_events` | `distances`への変更を表す追記専用イベントログ。書き込みの正。削除・修正は行わない     |
| `shot_events` | `shots`への変更を表す追記専用イベントログ。書き込みの正。削除・修正は行わない            |
| `target_faces`            | 的を表す。`owner_id`がnullならグローバル、値があれば個人登録   |
| `target_face_spots`       | 的の中の的中スポット（中心座標）を表す。1つの的が複数スポットを持てる（3つ目等の複数的配置）   |
| `target_face_rings`       | スポットの中の点数帯（同心円1本）を表す。半径・色・重なり順・得点を持つ                    |
| `round_presets`           | ラウンドの定型フォーマット（種別・弓種・距離構成）を表す。`owner_id`がnullならグローバル、値があれば個人プリセット |
| `preset_distances`        | `round_presets`が持つ距離構成の1行を表す                                            |

---

```mermaid
erDiagram
    users ||--o{ round_users : "1対多"
    rounds ||--o{ round_users : "1対多"
    rounds ||--o{ distances : "1対多"
    distances ||--o{ shots : "1対多"
    users ||--o{ shots : "1対多"
    users ||--o{ target_faces : "1対多"
    target_faces ||--o{ target_face_spots : "1対多"
    target_face_spots ||--o{ target_face_rings : "1対多"
    target_faces ||--o{ distances : "1対多"
    users ||--o{ round_presets : "1対多（owner）"
    round_presets ||--o{ preset_distances : "1対多"
    target_faces ||--o{ preset_distances : "1対多"
    users ||--o{ round_events : "1対多"
    users ||--o{ distance_events : "1対多"
    users ||--o{ shot_events : "1対多"

    users {
        uuid id PK "auth.users.idと同一。認証基盤側のアカウントと1対1対応"
        string name "表示名"
        timestamp created_at "作成時刻"
        timestamp updated_at "最終更新時刻"
    }
    rounds {
        uuid id PK "サロゲートID"
        string name "タイトル（例: 第2回紅白戦、自主練）"
        date round_date "記録日"
        string format "種別 [CHECK: outdoor / indoor / field]"
        string bow_type "弓種 [CHECK: recurve / compound / barebow]"
        bigint revision "現在のサーバー確定リビジョン [NOT NULL] [CHECK: >= 1]"
        timestamp disabled_at "論理削除時刻 [NULLABLE: null=有効、値あり=無効]"
        timestamp created_at "作成時刻"
        timestamp updated_at "最終更新時刻"
    }
    round_users {
        uuid id PK "サロゲートID"
        uuid round_id FK, UK "対象ラウンド [UK: (round_id, user_id)]"
        uuid user_id FK, UK "対象ユーザ [UK: (round_id, user_id)]"
        string role "ユーザのラウンドへのアクセス権限 [CHECK: editor / viewer]"
        timestamp created_at "作成時刻"
        timestamp updated_at "最終更新時刻"
    }
    distances {
        uuid id PK "サロゲートID"
        uuid round_id FK "所属ラウンド"
        string position_key "ラウンド内の並び順を表す可変長キー。表示番号は(position_key, id)順から導出"
        integer distance "距離（m） [CHECK: > 0] [NULLABLE: is_marked=falseの場合]"
        integer total_ends "総エンド数 [CHECK: > 0]"
        integer arrows_per_end "1エンドあたりの矢数 [CHECK: > 0]"
        uuid target_face_id FK "使用する的"
        boolean is_marked "距離が判明しているか [true=距離が判明している、false=距離不明]"
        bigint revision "現在のサーバー確定リビジョン [NOT NULL] [CHECK: >= 1]"
        timestamp disabled_at "論理削除時刻 [NULLABLE: null=有効、値あり=無効]"
        timestamp created_at "作成時刻"
        timestamp updated_at "最終更新時刻"
    }
    shots {
        uuid distance_id PK, FK "所属する距離 [PK: (distance_id, end_number, arrow_number)]"
        integer end_number PK "距離内で何番目のエンドか [PK: (distance_id, end_number, arrow_number)] [CHECK: > 0]"
        integer arrow_number PK "エンド内で何本目の射か [PK: (distance_id, end_number, arrow_number)] [CHECK: > 0]"
        uuid shooter_id FK "行射したユーザ"
        string score_str "点数の文字列表現（例：X, M, 10）"
        integer score_int "点数の整数表現"
        bigint revision "現在のサーバー確定リビジョン [NOT NULL] [CHECK: >= 1]"
        timestamp disabled_at "論理削除時刻 [NULLABLE: null=有効、値あり=無効]"
        timestamp created_at "作成時刻"
        timestamp updated_at "最終更新時刻"
    }
    round_events {
        uuid event_id PK "クライアント生成UUID。冪等性キー"
        uuid round_id "対象ラウンドの論理FK"
        string type "操作種別 [CHECK: CREATED / UPDATED / DISABLED]"
        uuid author_id FK "操作実行ユーザ"
        bigint revision UK "サーバー確定順 [NOT NULL] [CHECK: >= 1] [UK: (round_id, revision)]"
        string name "rounds.nameと同じ制約 [CREATED・UPDATED: 必須 / DISABLED: NULL]"
        date round_date "rounds.round_dateと同じ制約 [CREATED・UPDATED: 必須 / DISABLED: NULL]"
        string format "rounds.formatと同じ制約 [CREATED・UPDATED: 必須 / DISABLED: NULL]"
        string bow_type "rounds.bow_typeと同じ制約 [CREATED・UPDATED: 必須 / DISABLED: NULL]"
        timestamp created_at "サーバー受領時刻 [DEFAULT: clock_timestamp()]"
        timestamp updated_at "最終更新時刻"
    }
    distance_events {
        uuid event_id PK "クライアント生成UUID。冪等性キー"
        uuid round_id "対象ラウンドの論理FK"
        uuid distance_id "対象距離の論理FK"
        string type "操作種別 [CHECK: CREATED / UPDATED / DISABLED]"
        uuid author_id FK "操作実行ユーザ"
        bigint revision UK "サーバー確定順 [NOT NULL] [CHECK: >= 1] [UK: (distance_id, revision)]"
        string position_key "distances.position_keyと同じ制約 [CREATED・UPDATED: 必須 / DISABLED: NULL]"
        integer distance "distances.distanceと同じ制約 [CREATED・UPDATED: is_marked=trueなら必須・falseならNULL / DISABLED: NULL]"
        boolean is_marked "distances.is_markedと同じ制約 [CREATED・UPDATED: 必須 / DISABLED: NULL]"
        integer total_ends "distances.total_endsと同じ制約 [CREATED・UPDATED: 必須 / DISABLED: NULL]"
        integer arrows_per_end "distances.arrows_per_endと同じ制約 [CREATED・UPDATED: 必須 / DISABLED: NULL]"
        uuid target_face_id "distances.target_face_idと同じ制約 [CREATED・UPDATED: 必須 / DISABLED: NULL]"
        timestamp created_at "サーバー受領時刻 [DEFAULT: clock_timestamp()]"
        timestamp updated_at "最終更新時刻"
    }
    shot_events {
        uuid event_id PK "クライアント生成UUID。冪等性キー"
        uuid distance_id "対象距離の論理FK"
        string type "操作種別 [CHECK: RECORDED / CLEARED]"
        uuid author_id FK "操作実行ユーザ"
        bigint revision UK "サーバー確定順 [NOT NULL] [CHECK: >= 1] [UK: (distance_id, end_number, arrow_number, revision)]"
        integer end_number "shots.end_numberと同じ制約。全イベント種別で必須"
        integer arrow_number "shots.arrow_numberと同じ制約。全イベント種別で必須"
        uuid shooter_id FK "shots.shooter_idと同じ制約 [RECORDED: 必須 / CLEARED: NULL]"
        string score_str "shots.score_strと同じ制約 [RECORDED: 必須 / CLEARED: NULL]"
        integer score_int "shots.score_intと同じ制約 [RECORDED: 必須 / CLEARED: NULL]"
        timestamp created_at "サーバー受領時刻 [DEFAULT: clock_timestamp()]"
        timestamp updated_at "最終更新時刻"
    }
    target_faces {
        uuid id PK "サロゲートID"
        uuid owner_id FK "所有ユーザー [NULLABLE: null=グローバル、値あり=個人登録]"
        string name "的名（例：Outdoor 122cm）"
        bigint size "的の呼称サイズ（cm） [CHECK: > 0]"
        string format "対応する種別 [CHECK: outdoor / indoor / field]"
        string_array bow_type "対応する弓種配列 [CHECK: recurve / compound / barebow] [NULLABLE: 空配列=弓種指定なし]"
        timestamp created_at "作成時刻"
        timestamp updated_at "最終更新時刻"
    }
    target_face_spots {
        uuid id PK "サロゲートID"
        uuid target_face_id FK "所属する的"
        numeric center_x "スポットの中心座標X（cm）"
        numeric center_y "スポットの中心座標Y（cm）"
        timestamp created_at "作成時刻"
        timestamp updated_at "最終更新時刻"
    }
    target_face_rings {
        uuid id PK "サロゲートID"
        uuid spot_id FK "所属するスポット"
        numeric radius "リングの外側半径（cm）"
        string color "リングの色（HEX）"
        string line_color "境界線の色（HEX） [NULLABLE: null=境界線なし]"
        integer z_index "target_face全体での重なり順"
        string score_str "点数の文字列表現（例：X, M, 10）"
        integer score_int "点数の整数表現"
        timestamp created_at "作成時刻"
        timestamp updated_at "最終更新時刻"
    }
    round_presets {
        uuid id PK "サロゲートID"
        uuid owner_id FK "所有ユーザー [NULLABLE: null=グローバル、値あり=個人プリセット]"
        string name "プリセット名（例：WA 1440）"
        string format "種別 [CHECK: outdoor / indoor / field]"
        string bow_type "弓種 [CHECK: recurve / compound / barebow]"
        timestamp created_at "作成時刻"
        timestamp updated_at "最終更新時刻"
    }
    preset_distances {
        uuid id PK "サロゲートID"
        uuid preset_id FK "所属するプリセット"
        string position_key "プリセット内の並び順を表す可変長キー。表示番号は(position_key, id)順から導出"
        integer distance "距離（m） [CHECK: > 0]"
        integer total_ends "総エンド数 [CHECK: > 0]"
        integer arrows_per_end "1エンドあたりの矢数 [CHECK: > 0]"
        uuid target_face_id FK "使用する的"
        boolean is_marked "距離が判明しているか [true=距離が判明している、false=距離不明]"
        timestamp created_at "作成時刻"
        timestamp updated_at "最終更新時刻"
    }
```
