# セキュリティ

## 認証

- **方式**: Supabase Auth（メール + パスワード）。新規登録時のみメール認証コード（OTP）でメールアドレスを検証したうえでパスワードを設定し、以降はメール + パスワードでサインインする
- **紐付け**: 認証成功時、`auth.users.id`と`public.users.id`を1:1で紐付ける

## レート制限・CAPTCHA

| 設定 | 制限対象 | 単位 | 制限値 |
| :--- | :--- | :--- | :--- |
| `rate_limit.sign_in_sign_ups` | 同一IPからのサインイン・サインアップリクエスト | 5分間 | 30回 |
| `rate_limit.token_verifications` | 同一IPからのOTP/マジックリンク検証 | 5分間 | 30回 |
| `rate_limit.token_refresh` | 同一IPからのセッションリフレッシュ | 5分間 | 150回 |
| `rate_limit.email_sent` | プロジェクト全体のメール送信数 | 1時間 | 100通 |
| `captcha`（Cloudflare Turnstile） | `signInWithPassword`・`signInWithOtp`・`resetPasswordForEmail`の各リクエスト（`verifyOtp`によるコード確認自体は対象外） | リクエストごと | Turnstile検証必須 |

レート制限はいずれもIP単位のため、captchaでリクエストごとのコストを上げてブルートフォースを抑止する。

## 認可マトリクス

| 対象テーブル   | SELECT                          | INSERT                        | UPDATE                        | DELETE                        |
| :------------ | :----------------------------- | :---------------------------- | :---------------------------- | :---------------------------- |
| `users`       | RLS: 認証済みユーザー全員 | RLS: 不可 | RLS: `auth.uid() = id` | RLS: `auth.uid() = id` |
| `rounds`      | RLS: `round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 認証済みユーザー（作成時に`editor`として登録） | RLS: 直接操作不可<br>RPC: `round_users.role = 'editor'` | RLS: 直接操作不可<br>RPC: `round_users.role = 'editor'` |
| `round_users` | RLS: `round_users`に自分が存在する | RLS: `round_users.role = 'editor'` | RLS: `round_users.role = 'editor'` | RLS: `round_users.role = 'editor'` |
| `distances`   | RLS: 所属ラウンドの`round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` |
| `shots`       | RLS: 所属ラウンドの`round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` |
| `round_events` | RLS: `round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 作成時は認証済み、以後は`round_users.role = 'editor'` | RLS: 不可（追記専用） | RLS: 不可（追記専用） |
| `distance_events` | RLS: 所属ラウンドの`round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 不可（追記専用） | RLS: 不可（追記専用） |
| `shot_events` | RLS: 所属ラウンドの`round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 不可（追記専用） | RLS: 不可（追記専用） |
| `target_faces`, `target_face_spots`, `target_face_rings` | RLS: 認証済みユーザー全員 | RLS: `auth.uid() = owner_id` | RLS: `auth.uid() = owner_id` | RLS: `auth.uid() = owner_id` |
| `preset_rounds`, `preset_distances` | RLS: 認証済みユーザー全員 | RLS: `auth.uid() = owner_id` | RLS: `auth.uid() = owner_id` | RLS: `auth.uid() = owner_id` |

子テーブル（`target_face_spots`/`target_face_rings`、`preset_distances`）は親テーブルの`owner_id`判定に従う（親を辿ってRLSを評価する。`distances`/`shots`が`round_users`を辿るのと同じパターン）。

ラウンド・距離・矢の変更は専用のイベントRPCだけを経由する。RPCはクライアントから受け取った識別子を権限判定の根拠としてそのまま信用せず、対象の親関係から実際のラウンドを特定し、`auth.uid()`がそのラウンドの`editor`であることを確認する。`author_id`もRPC内で`auth.uid()`から設定する。権限確認、イベント追記、`revision`採番、射影更新は同一トランザクションで行う。
