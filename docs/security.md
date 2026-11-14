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

パスワード変更(`updateUser`)は、認証サービスが現在のパスワードを検証する(`[auth.email] require_current_password = true`)。
画面を使わない直接呼び出しにも効く(本番で有効であることが前提)。
この更新はcaptchaを経由しない。
現在のパスワードの確認は、OWASP Authentication Cheat SheetとASVS 2.1.6(4.0.3相当。原文は未確認)が、パスワード変更に求める。
`secure_password_change`(メールの認証コード)は、作成から24時間以内のセッションを検査せず、現在のパスワードとコードの両方を要する構成も採らないため、有効にしない。
現在のパスワードの総当たりに対するサーバー側の試行回数の制限は、ローカルの実測(誤りを約240回続けて429が出ない)で確認できなかった。
サインイン済みのセッションを持つ者が、制限なしに推測できる前提を、残余リスクとして扱う。
本番の制限は未確認である。
本番で設定が効かないと、現在のパスワードの検査なしに更新が成功する。
設定の確認は、まずプレビューで行う。
プレビューは別のSupabaseプロジェクトで、本番は`cd.yml`で別に反映されるため、プレビューで確認できても本番の効きは分からず、本番自体で確認するまで未確認である。
プレビューでは、専用の試験用アカウントを`signInWithPassword`でサインインさせ(セッションはamr=password。認証コード由来のセッションは免除されて成功し、設定が効いていないと誤判定する)、`updateUser({ password })`を`current_password`なしで呼んで400 `current_password_required`で拒否されることを確かめる(拒否されなければパスワードが変わるため、試験用アカウントだけで行う)。
本番では、`signInWithPassword`に実Turnstileトークンが要る(`cd.yml`は`TURNSTILE_PROD_SECRET_KEY`。プレビューはテスト用の常に通過する値)。
そのため、本番では、アプリの画面で試験用アカウントにサインインし、ブラウザの開発者ツールで、保存されたアクセストークンを使って`PUT /auth/v1/user`を`current_password`なしで呼ぶ。
確認の担当は開発者で、時機はマージ後である。
設定が本番へ反映されてから、プレビューと本番で確認する(`supabase config push`はmainへのpushで実行されるため、マージ前には設定が入らない)。
認証コード(OTP)で得たセッション(amr=otp)の更新は、`require_current_password`の検査を免除される(実測)。
これを塞ぐため、サインアップの完了時に、`signInWithPassword`でセッションを置き換え、`signOut({ scope: 'others' })`で古いセッションを無効にする。
そのため、パスワード設定の段階でcaptchaを取り直す。
残余リスク(受け入れる): (1)この変更より前に登録した利用者の認証コード由来のセッションは、掃除しないため、サインアウトまたは失効までは免除が残る。
(2)置き換えの前の離脱と置き換えの失敗、`others`の失敗で、認証コード由来のセッションが残りうる。
(3)置き換えの完了前に盗まれ、置き換えまたは`others`が失敗したか、完了前に悪用された認証コード由来のセッションは、盗んだ者が現在のパスワードなしでパスワードを変更できる(`others`が成功すれば、盗まれたものも、認証サービスの取得・更新では無効になる。実測。期限内のアクセストークンでのデータの読み書きは通りうる。(5)と同じ)。
(3)の`others`の成功は、戻り値だけでは保証されない。
auth-js 2.112.3の`signOut`は、`scope: 'others'`で401・403・404を成功として返すため、戻り値の成功とサーバーでの終了が一致しない場合がある。
(4)パスワード再設定で、確認の成功後に離脱するか`signOutHere`が失敗すると、認証コード由来のセッションが残る。
(5)パスワードを変更した後も、他の端末は、アクセストークンの期限(最大約1時間)が切れるまで、データを読み書きできる。
ブラウザでの動作は、独立したローカルのスタックでのE2Eで確かめた(登録直後のサインインがパスワード由来であること、現在のパスワードなしの更新の拒否、置き換え前のOTPのトークンの拒否、他の端末の終了、拒否の後も他の端末が維持されること)。
本番の反映、24時間を超えたセッション、amr=otpでの検証順、実のTurnstileトークンの有効期間は、確かめていない。
Cloudflareのトークンの有効期間は、プレビューのsecretが常に通過するテスト値のため、E2Eでは確かめられず、本番でのみ確認できる。
Google認証など、amrがotpでもpasswordでもないセッションでの`require_current_password`の扱いは未測定で、足すときに確かめる。

## 認可マトリクス

| 対象テーブル   | SELECT                          | INSERT                        | UPDATE                        | DELETE                        |
| :------------ | :----------------------------- | :---------------------------- | :---------------------------- | :---------------------------- |
| `users`       | RLS: `auth.uid() = id` | RLS: 不可 | RLS: `auth.uid() = id` | RLS: 不可 |
| `rounds`      | RLS: `round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 認証済みユーザー（作成時に`editor`として登録） | RLS: 直接操作不可<br>RPC: `round_users.role = 'editor'` | RLS: 直接操作不可<br>RPC: `round_users.role = 'editor'` |
| `round_users` | RLS: `round_users`に自分が存在する | RLS: 直接操作不可 | RLS: 直接操作不可 | RLS: 直接操作不可 |
| `distances`   | RLS: 所属ラウンドの`round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` |
| `shots`       | RLS: 所属ラウンドの`round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` |
| `round_events` | RLS: `round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 作成時は認証済み、以後は`round_users.role = 'editor'` | RLS: 不可（追記専用） | RLS: 不可（追記専用） |
| `distance_events` | RLS: 所属ラウンドの`round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 不可（追記専用） | RLS: 不可（追記専用） |
| `shot_events` | RLS: 所属ラウンドの`round_users`に自分が存在する | RLS: 直接操作不可<br>RPC: 所属ラウンドの`round_users.role = 'editor'` | RLS: 不可（追記専用） | RLS: 不可（追記専用） |
| `target_faces`, `target_face_spots`, `target_face_rings` | RLS: 認証済みユーザー全員 | RLS: 直接操作不可 | RLS: 直接操作不可 | RLS: 直接操作不可 |
| `preset_rounds` | RLS: 認証済みユーザー全員 | RLS: `auth.uid() = owner_id` | RLS: 不可 | RLS: `auth.uid() = owner_id` |
| `preset_distances` | RLS: 認証済みユーザー全員 | RLS: 親の`owner_id`が`auth.uid()`と一致する | RLS: 不可 | RLS: 不可（親の削除の`CASCADE`で消える） |

`preset_distances`のINSERTは親の`preset_rounds.owner_id`判定に従う（親を辿ってRLSを評価する。`distances`/`shots`が`round_users`を辿るのと同じパターン）。
`distances`のSELECTは見える`rounds`があること、`shots`のSELECTは見える`distances`があることで判定し、`is_round_member`を直接呼ぶのは`rounds`だけである（親の表のRLSを通して`round_users`を辿る）。`shot_events`・`distance_events`は`is_round_member`を直接呼ぶ。

「直接操作不可」はRLSポリシーとテーブルのGRANTの両方がなく、`permission denied`（42501）で拒否される。
書き込み経路が必要になった時点で、ポリシーとGRANTを設計して追加する。
`round_users`はメンバー管理の書き込み経路がなく、チーム機能で必要になった時点で設計する。
`target_faces`系はシードのみで、アプリから書き込まない。
`users`の行は`handle_new_user`トリガーが作り、`auth.users`の削除の`CASCADE`で消える。

ラウンド・距離・矢の変更は専用のイベントRPCだけを経由する。RPCはクライアントから受け取った識別子を権限判定の根拠としてそのまま信用せず、対象の親関係から実際のラウンドを特定し、`auth.uid()`がそのラウンドの`editor`であることを確認する。`author_id`もRPC内で`auth.uid()`から設定する。権限確認、イベント追記、`revision`採番、射影更新は同一トランザクションで行い、確定した`revision`を返す。

書き込みRPCの拒否は2種類で、認可の拒否は`PT403`、契約の不一致(引数の形や範囲の不正)は`PT422`である。`PTxyz`はPostgRESTがHTTPステータスxyzで返す独自のSQLSTATEで、Postgres自身のコード(権限不足の`42501`など)と区別できる。
業務規則(後勝ち、削除、不変条件、構成と矢の整合)で効かない操作・項目は、拒否せず受理して応答で返す。イベントには効いた項目だけを記録し、効かなかった操作・項目と拒否した操作はどこにも記録しない。
存在しない距離への操作は、認可より前に`MISSING`で効かないと返す。距離IDは端末が作る推測できないUUIDで、他のラウンドの情報は漏れない。存在する距離への権限の無い呼び出しは`PT403`で拒否する。
履歴の取得の関数`rounds_list`・`distances_list`と、それらが対象のラウンドとして読む`history_rounds`は、呼び出し元の権限で動く(`SECURITY INVOKER`)読み取り専用の関数で、認可はSELECTのRLSに従う。実行権限は`authenticated`だけが持つ。引数は検証せず、返るのは呼び出し元が属するラウンドだけである。
`history_rounds`だけは、呼び出し元へ展開させるため`SET search_path`を付けず、本文の表と関数の名前を修飾する。`SECURITY INVOKER`の読み取り専用で、`search_path`を変えられても権限は上がらない。
`shot_fits`(矢が距離の構成で有効かの判定)は、`PUBLIC`・`anon`・`authenticated`の実行権限を持たない内部関数である。
