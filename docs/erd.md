# ERD（エンティティ関連図）

| テーブル名     | 説明                                                                             |
| :------------ | :------------------------------------------------------------------------------ |
| `users`       | ユーザーの基本プロフィール情報を保持する                                            |
| `rounds`      | アーチェリーの記録単位となる「ラウンド」を表す。距離構成は`distances`が持つ                |
| `round_users` | 特定のラウンドに対するユーザーのアクセス権限・ロールを管理する                        |
| `distances`   | ラウンド中に射撃する特定の距離を表す                                                |
| `shots`       | 個々の矢のスコアと属性を記録する                                                    |

---

```mermaid
erDiagram
    users ||--o{ round_users : "1対多"
    rounds ||--o{ round_users : "1対多"
    rounds ||--o{ distances : "1対多"
    distances ||--o{ shots : "1対多"
    users ||--o{ shots : "1対多"

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
        timestamp created_at
        timestamp updated_at
    }
    shots {
        uuid id PK
        uuid distance_id FK, UK
        integer end_number UK "エンド番号"
        integer arrow_number UK "矢番号"
        uuid user_id FK, UK
        string score_str "1〜10, M, X（score_intと矛盾しないようCHECK制約で保証）"
        integer score_int "0〜10（score_strと矛盾しないようCHECK制約で保証）"
        timestamp created_at
        timestamp updated_at
    }
```

- `shots`は`(distance_id, user_id, end_number, arrow_number)`に一意制約を持ち、この4列をキーにupsertする。
- ラウンド作成は`create_round(name, round_date, distances)` RPC（`SECURITY DEFINER`）経由でのみ行う。`round_users`への登録・`rounds`・`distances`の作成をこの関数内で順に行い、原子性を保つ。`rounds`への直接INSERTは許可しない（詳細は[docs/security.md](./security.md)参照）。
- 「距離・的の種類・的のサイズ」などラウンドの競技形式を細かく区別する要素は実際には非常に多岐にわたるため、v0.2.0（PoC）では意図的に対象外とし、`rounds`は記録単位としての名前と実施日のみを持つ。的管理・定型ラウンド選択はv1.0.0（MVP）で導入予定（[docs/roadmap.md](./roadmap.md)参照）。
