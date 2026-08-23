# Data Map (データ配置図)

[`screen-flow.md`](screen-flow.md)の各画面/操作と、[`erd.md`](erd.md)で確定済みの5テーブルとの対応。アクセス制御は[`security.md`](security.md)のAuthorization Matrixに従う。

| 画面 / 操作 | 対象テーブル | 処理内容 |
| :--- | :--- | :--- |
| 初回サインイン | `users` | Supabase Auth (`auth.users`) と1:1で`public.users`を作成 |
| `/rounds/new` でラウンド作成 | `rounds`, `round_users`, `distances` | `rounds`を作成 → 作成者を`round_users`に`editor`として登録 → 距離構成ごとに`distances`を作成 |
| `/rounds/[id]/record` で矢を入力 | `shots` | エンド・矢番号ごとに`shots`（`distance_id`, `end_number`, `arrow_number`, `user_id`, `score_str`, `score_int`）をupsert |
| `/rounds/[id]` でサマリー表示 | `rounds`, `distances`, `shots` | `rounds`を起点に`distances` → `shots`を結合取得し、合計・X数などをクライアント側の純粋関数で算出 |
| `/rounds` で一覧表示 | `round_users`, `rounds`, `distances`, `shots` | 自分が属する`round_users`経由で`rounds`を絞り込み、各ラウンドの合計点等を集計して表示 |

## 補足

- `shots.user_id`は個人の矢を誰が射たかを表すフィールドのため、将来1つのラウンドを複数人で共有するチームスコアリングにもそのまま対応できる（MVPでは常に本人のみ）。
- `round_users`はチーム招待UIが無いMVPでも、RLS上ラウンドへのアクセス可否判定に必須のため、ラウンド作成時に作成者を自動登録する。ただし[`security.md`](security.md)の認可マトリクス上、`round_users`へのINSERTは自己参照条件（既に`editor`であること）のため、作成者自身の最初の1行はクライアントから直接INSERTできない。[`security.md`](security.md)「初期データの自動登録」の通り、`SECURITY DEFINER`のDBトリガーがRLSを回避して自動登録する。
