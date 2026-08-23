# セキュリティ

## 認証

- **方式**: Supabase Auth（メール + パスワード）。新規登録時のみメール確認コード（OTP）でメールアドレスを検証したうえでパスワードを設定し、以降はメール + パスワードでサインインする
- **紐付け**: 認証成功時、`auth.users.id`と`public.users.id`を1:1で紐付ける

## 認可マトリクス

| 対象テーブル   | SELECT                          | INSERT                        | UPDATE                        | DELETE                        |
| :------------ | :----------------------------- | :---------------------------- | :---------------------------- | :---------------------------- |
| `users`       | 認証済みユーザー全員               | なし                          | `auth.uid() = id`             | `auth.uid() = id`             |
| `rounds`      | `round_users`に自分が存在する      | なし（`create_round` RPC経由のみ） | `round_users.role` = 'editor' | `round_users.role` = 'editor' |
| `round_users` | `round_users`に自分が存在する      | `round_users.role` = 'editor' | `round_users.role` = 'editor' | `round_users.role` = 'editor' |
| `distances`   | `round_users`に自分が存在する      | `round_users.role` = 'editor' | `round_users.role` = 'editor' | `round_users.role` = 'editor' |
| `shots`       | `round_users`に自分が存在する      | `round_users.role` = 'editor' | `round_users.role` = 'editor' | `round_users.role` = 'editor' |

## 初期データの自動登録

`round_users`のINSERT条件は自己参照（既に`editor`である必要がある）のため、クライアントからの素朴なINSERTでは、あるラウンドの最初の1行（作成者自身の`editor`登録）を作ることができない。また`INSERT ... RETURNING`（`supabase-js`の`.select()`等）は挿入直後にSELECTポリシーの評価も要求するが、これは同一ステートメント内のトリガー副作用を参照できないため、「`rounds`作成→トリガーで`round_users`登録」という順序ではRETURNING時点で`round_users`が未反映のままRLSに弾かれる。

このため、ラウンド作成は`create_round(name, round_date, distances)` RPC（`SECURITY DEFINER`、RLSの対象外）に一本化し、関数内で**`round_users`への登録を先に行ってから**`rounds`・`distances`を作成する。別ステートメントとして先に完了した登録は後続のRETURNINGから正しく参照できるため、RLSに弾かれない。`rounds`への直接INSERTポリシーは設けず、この関数経由の作成のみを許可する。

同様に自己参照で初回登録ができない`users`テーブルの初期化（`auth.users`の作成をトリガーに`public.users`を生成）は、素朴な1テーブルのAFTER INSERTトリガーのままで問題ない（RETURNINGで即座に自分自身の行を参照する必要がないため）。
