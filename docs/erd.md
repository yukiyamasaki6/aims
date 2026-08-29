# ERD（エンティティ関連図）

| テーブル名                  | 説明                                                                             |
| :------------------------ | :------------------------------------------------------------------------------ |
| `users`                   | ユーザーの基本プロフィール情報を保持する                                            |
| `rounds`                  | アーチェリーの記録単位となる「ラウンド」を表す。距離構成は`distances`が持つ                |
| `round_users`             | 特定のラウンドに対するユーザーのアクセス権限・ロールを管理する                        |
| `distances`               | ラウンド中に射撃する特定の距離を表す                                                |
| `shots`                   | 個々の矢のスコアと属性を記録する                                                    |
| `target_faces`            | 的（ターゲットフェイス）を表す。`owner_id`がnullならグローバル（全ユーザー共通）、値があれば個人登録   |
| `target_face_spots`       | 的の中の的中スポット（中心座標）を表す。1つの的が複数スポットを持てる（3つ目等の複数的配置）   |
| `target_face_rings`       | スポットの中の点数帯（同心円1本）を表す。半径・色・重なり順・得点を持つ                    |
| `round_presets`           | ラウンドの定型フォーマット（種別・弓種・距離構成）を表す。`owner_id`がnullならグローバル、値があれば個人プリセット |
| `round_preset_distances`  | `round_presets`が持つ距離構成の1行を表す                                            |

---

```mermaid
erDiagram
    users ||--o{ round_users : "1対多"
    rounds ||--o{ round_users : "1対多"
    rounds ||--o{ distances : "1対多"
    distances ||--o{ shots : "1対多"
    users ||--o{ shots : "1対多"
    users ||--o{ target_faces : "1対多（owner）"
    target_faces ||--o{ target_face_spots : "1対多"
    target_face_spots ||--o{ target_face_rings : "1対多"
    target_faces ||--o{ distances : "1対多（参照）"
    users ||--o{ round_presets : "1対多（owner）"
    round_presets ||--o{ round_preset_distances : "1対多"
    target_faces ||--o{ round_preset_distances : "1対多（参照）"

    users {
        uuid id PK
        string name
        timestamp created_at
        timestamp updated_at
    }
    rounds {
        uuid id PK
        string name "個人が自由に付けるタイトル。例: 第2回紅白戦、自主練"
        date round_date "ラウンドが実施された日"
        string format "outdoor / indoor / field"
        string bow_type "recurve / compound / barebow"
        timestamp created_at
        timestamp updated_at
    }
    round_users {
        uuid id PK
        uuid round_id FK
        uuid user_id FK
        string role "editor / viewer"
        timestamp created_at
        timestamp updated_at
    }
    distances {
        uuid id PK
        uuid round_id FK
        integer distance_number "距離の順番"
        integer distance "70 / 50 / 30 / 18 等"
        integer total_ends
        integer arrows_per_end "3 / 6 等"
        uuid target_face_id FK
        timestamp created_at
        timestamp updated_at
    }
    shots {
        uuid id PK
        uuid distance_id FK, UK
        integer end_number UK "エンド番号"
        integer arrow_number UK "矢番号"
        uuid user_id FK, UK
        string score_str "1〜10, M, X"
        integer score_int "0〜10"
        timestamp created_at
        timestamp updated_at
    }
    target_faces {
        uuid id PK
        uuid owner_id FK "null=グローバル"
        string name
        bigint size "的紙の実サイズ（cm）。6点的等はリング最外径と一致しない"
        string format "outdoor/indoor/field。的選択UIの並び順に使う"
        timestamp created_at
        timestamp updated_at
    }
    target_face_spots {
        uuid id PK
        uuid target_face_id FK
        numeric center_x "cm単位"
        numeric center_y "cm単位"
        timestamp created_at
        timestamp updated_at
    }
    target_face_rings {
        uuid id PK
        uuid spot_id FK
        numeric radius "cm単位"
        string color "塗り色（HEX）"
        string line_color "境界線の色（HEX）。null=なし"
        integer z_index "target_face全体で共通の重なり順"
        string score_str "X, 10, 9 等"
        integer score_int "0〜10"
        timestamp created_at
        timestamp updated_at
    }
    round_presets {
        uuid id PK
        uuid owner_id FK "null=グローバル"
        string name "70W / SH / WA1440 等"
        string format "outdoor / indoor / field"
        string bow_type "recurve / compound / barebow"
        timestamp created_at
        timestamp updated_at
    }
    round_preset_distances {
        uuid id PK
        uuid preset_id FK
        integer distance_number
        integer distance
        integer total_ends
        integer arrows_per_end
        uuid target_face_id FK
        timestamp created_at
        timestamp updated_at
    }
```
