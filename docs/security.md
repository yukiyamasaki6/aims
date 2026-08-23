# セキュリティ

## 認証

- **方式**: Supabase Auth（メール + パスワード）。新規登録時のみメール確認コード（OTP）でメールアドレスを検証したうえでパスワードを設定し、以降はメール + パスワードでサインインする
- **紐付け**: 認証成功時、`auth.users.id`と`public.users.id`を1:1で紐付ける

## 認可マトリクス

| 対象テーブル   | SELECT                          | INSERT                        | UPDATE                        | DELETE                        |
| :------------ | :----------------------------- | :---------------------------- | :---------------------------- | :---------------------------- |
| `users`       | 認証済みユーザー全員               | なし                          | `auth.uid() = id`             | `auth.uid() = id`             |
| `rounds`      | `round_users`に自分が存在する      | 認証済みユーザー全員             | `round_users.role` = 'editor' | `round_users.role` = 'editor' |
| `round_users` | `round_users`に自分が存在する      | `round_users.role` = 'editor' | `round_users.role` = 'editor' | `round_users.role` = 'editor' |
| `distances`   | `round_users`に自分が存在する      | `round_users.role` = 'editor' | `round_users.role` = 'editor' | `round_users.role` = 'editor' |
| `shots`       | `round_users`に自分が存在する      | `round_users.role` = 'editor' | `round_users.role` = 'editor' | `round_users.role` = 'editor' |

## 初期データの自動登録

`round_users`のINSERT条件は自己参照（既に`editor`である必要がある）のため、クライアントからの素朴なINSERTでは、あるラウンドの最初の1行（作成者自身の`editor`登録）を作ることができない。この初回登録は、`rounds`作成後に発火する`SECURITY DEFINER`のDBトリガー（テーブル所有者権限で実行され、RLSの対象外となる）で自動的に行う。同様の仕組みは`users`テーブルの初期化（`auth.users`の作成をトリガーに`public.users`を生成）にも用いる想定で、クライアントは`round_users`へ直接INSERTしない。
