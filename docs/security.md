# セキュリティ

## 認証

- **方式**: Supabase Authの標準メールOTP、またはGoogle(OAuth、PKCE)で新規認証する。登録とログインの入口を分け、コードの送付・閲覧・リンク操作だけでは認証しない。
- **紐付け**: auth.users.idとpublic.users.idを1:1で維持し、既存利用者と記録を再作成しない。
- **パスワードの禁止**: Custom Access Token Hookで今回の方式がpasswordならトークン発行を拒否する。許可はotp・token_refresh・email_change・oauth(Googleでのサインインと結合の戻りの交換)だけで、欠落とその他(id_tokenを含む)も拒否する。
- **保存データ**: 切替処理は既存パスワードハッシュを変更しない。OTP新規登録でAuthが内部のランダム値を保存しても、パスワード認証への利用を禁止する。
- **旧コード**: 切替で旧confirmation/recoveryコードを失効させない。切替直後は最大15分、旧コードが有効なまま残るのを許容する。コードは本人のメールにしか届かず、回復コードをメールOTPと同等とする方針と整合し、パスワード認証は復活しない。
- **既存セッション**: 今回の方式がtoken_refreshなら、過去のamrにpasswordがあっても更新を許す。切替時に一斉失効・署名鍵変更を行わない。
- **Hook権限**: claimsをそのまま返すSECURITY INVOKER関数を使い、実行はsupabase_auth_adminだけに許可する。PUBLIC・anon・authenticatedから実行できない。

## レート制限・CAPTCHA

| 設定 | 制限対象 | 単位 | 制限値 |
| --- | --- | --- | --- |
| rate_limit.sign_in_sign_ups | 同一IPからのサインイン・登録要求 | 5分間 | 30回 |
| rate_limit.token_verifications | 同一IPからのOTP確認 | 5分間 | 30回 |
| rate_limit.token_refresh | 同一IPからのセッション更新 | 5分間 | 150回 |
| rate_limit.email_sent | プロジェクト全体のメール送信 | 1時間 | 100通 |
| CAPTCHA（Turnstile） | signInWithOtpによる送信・再送、メール変更のコード再送。削除の再確認も同じAPIを使う。GoogleのOAuth(サインイン・追加)は対象外 | 要求ごと | 検証必須 |

verifyOtpによるコード確認と削除RPCはCAPTCHAを要さない。コード確認は標準Authの検証制限を通す。
UIの60秒の再送待機に加えて、プレビュー・本番のAuth送信間隔も60秒に設定する。IP制限はホスト側の正しいヘッダ設定を前提とする。
独自のOTP照合、試行回数カウンター、署名鍵、削除チャレンジは置かない。

## Google

- **自動結合**: 確認済みの同じメールアドレスの利用者へ、認証サービスがGoogleの手段を自動で結び付ける(止められない)。
- **手動の結合**: 有効にする(認証サービスのbeta)。追加は`linkIdentity`で、認証サービスは`/callback`の時点で、追加を始めたセッションの利用者に結び付ける。別の利用者に結び付いたGoogleは`identity_already_exists`で拒否される。追加の前の再認証は求めない。
- **知らせるメール**: 認証サービスの標準の通知メール(結合`identity_linked`、解除`identity_unlinked`)を有効にする。送るのは認証サービスで、アカウントのメールアドレスへ届く。AIMSは送らない。
- **解除**: 画面はGoogleの解除だけを提供する。DB関数`ensure_email_identity()`(SECURITY DEFINER、authenticatedだけ、本人だけ、確認済みのアドレスだけ)で、認証サービスのメール変更の完了時と同じ形のメールの手段を作ってから、標準の`unlinkIdentity`を呼ぶ。関数は本人の確認済みの`auth.users.email`を手段として形にするだけで、OTPでサインインできる範囲を変えない。
- **メールの手段の解除の禁止**: `auth.users`の行が残ったまま`auth.identities`からメールの手段(`provider = 'email'`)だけを削除することを、DBのトリガーで拒否する。
  直接の`unlinkIdentity`で、攻撃者のGoogleを結び付けた後にメールの手段を外し、メール変更の二重確認なしにアカウントを乗っ取る連鎖を防ぐため。
  アカウント削除に伴う手段の行の削除、Googleの解除、メール変更の完了による書き換えは通す。
  確認していないアカウント(コードを要求しただけ)の未確認の手段は、同じアドレスのGoogleの自動結合で認証サービスが消すため通す。記録を持たず、連鎖の対象にならない。
  画面にはメールの手段を外す操作が無く、画面の動作と利用者への影響は変わらない。
- **設定値**: GoogleのクライアントIDはGitHubのVariables、シークレットはGitHubのSecretsから、`supabase config push`で環境ごとに入れ、リポジトリに置かない。戻り先は`additional_redirect_urls`の許可リストに限る。

## メール変更・削除の認可

メール変更はdouble_confirm_changesを有効にし、現在と新しいメールの両方のコードを要求する。現在のパスワードは要求しない。
メール変更後も他の端末のセッションを一斉終了せず、確認結果のOTPセッションをSDKが採用する。
削除RPCは、要求対象IDとauth.uidが一致し、利用者が実在することを確認し、DB時刻でJWTのamrにmethod=otpの直近60秒以内の証跡があることを検査する。
60秒ちょうどを許容し、パスワードだけ・欠落・不正・古い証跡・未来の時刻を拒否する。iat・更新時刻・利用者全体の最終ログイン時刻で代用しない。
画面は直近のOTPログインがあっても削除のたびに新しいコード確認を求める。DBは通常ログインのOTP認証も区別せず、画面を介さない呼出しにも同じ条件を適用する。OTP不足の場合は削除・匿名化を行わない。
OTPの再確認は同じ利用者の新セッションを作り、古いJWTや別セッションの認証時刻を更新しない。
削除はSECURITY DEFINER関数で行い、サービスロールと管理APIを使わない。Authがコードの正誤を検証し、DBは認証証跡と対象を認可する。

## 受け入れる残余リスク

- 画面は削除のたびにコード確認を求めるが、DBはそれを区別しない。直近60秒の有効なOTP由来JWTを持つ者は、画面を介さず直接RPCを呼べば、通常ログイン直後も追加確認なしで削除できる。削除用途の証明と単回許可は保証しない。
- サインアウト等で認証サービス上のセッションを終了しても、期限内のJWTはDBの署名・期限・amr条件を満たす間は利用できる。RPCはAuthのセッション現存を毎回問い合わせない。
- 同じ放置端末でメールも利用可能なら、新しいコードを取得される可能性がある。OTPはフィッシングへの耐性や要求端末への束縛を保証しない。
- 直接APIからパスワードの設定・変更自体が成功することはある。保存値や他セッションへの影響は残るが、Hookによりパスワードによる新規認証は復活しない。
- サインイン済み利用者はメール変更の直接API応答から登録有無を調べられる。画面の登録・ログインは既知の応答を共通表示にする(Googleの手段にだけ残るアドレスの例外を除く。下の「古い・異なるGoogleのアドレス」)。
- 削除後の旧JWTは期限まで認証サービス以外へ届く。対象の記録は参加・プロフィールのRLSで見えず、書込みは参加検査・外部キーで拒否するが、的や共有プリセットは従来の共有権限で読める。同じメールの再登録先には結び付かない。
- ハッシュ保持は保存データ自体の削除を意味しない。以前のパスワードへの自動復帰も保証しない。
- 削除の前に取得したバックアップには、削除したアカウント(メールアドレス、認証手段)と記録が、取得から最大30日残る。保管先は運営者だけが読め、期限を過ぎると消える。復元するときは、取得の後に削除されたアカウントを削除の後と同じ状態に戻す(`docs/backup.md`)。
- そのため、削除の記録(`deletions/<利用者ID>`)が、バックアップの外の保管先に残る。中身と保持期間は`docs/features/auth/delete-account/requirements.md`の「削除される記録」に従う。運営者だけが読め、期間内はロックで消すことも上書きすることもできない。
- 削除の記録のWorkerに届かない間(Cloudflareの障害、Vaultの設定の欠落を含む)は、アカウントの削除が失敗する。削除の記録を残せないまま削除しないため(`docs/backup.md`)。
- 削除の記録を書いた後にDBのコミットが失敗すると、削除されていない利用者の記録が残る。復元すると、その利用者は削除の後と同じ状態になる。起きる見込みは低い。
- Googleの自動結合: そのGoogleアカウントを使える者は、同じメールアドレスの既存のアカウントに入れる。メールアドレスを使える者がOTPで入れることと同じ程度の危険として受け入れる。
- Googleで作ったアカウントにも、Googleのアドレスへのメールのコードでサインインできる。
- 追加の前の本人確認が無い: 盗まれたセッションで攻撃者のGoogleを結び付けられ、以後そのGoogleでサインインされうる。認証サービスの標準の通知メール(結合)で気付き、設定から解除できる。
- 古い・異なるGoogleのアドレス(登録有無を知らせない方針の例外):
  - 対象は、どの利用者のメールアドレスでもなく、Googleの手段にだけ残るアドレス(メール変更前のGoogleのアドレス、アカウントと異なるアドレスで追加したGoogleのアドレス)である。
  - このアドレスでOTPを要求すると、認証サービスは422 `user_already_exists`を返し、メールを送らず、フックも呼ばない。
  - 直接の呼出しで、そのアドレスがGoogleの手段として使われていることが分かる。画面で隠しても守れず、正当な利用者の不利益になるだけのため、画面も「このメールアドレスはGoogleアカウントで登録されています。」と示し、コード入力へ進めない(auth/signin)。
  - 例外はこの場合に限る。通常の登録済み・未登録のアドレスは、従来どおり共通の表示にする。
  - 案内のために、新しい送信の仕組みは作らない。

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
`delete_account(expected_user_id)`はSECURITY DEFINERで、EXECUTEは`authenticated`だけが持つ(`PUBLIC`・`anon`は持たない)。`users`の削除と、他の表の削除・匿名化は、この関数だけが行う。匿名化の置き先は「削除済みの利用者」(`00000000-0000-4000-8000-000000000001`)で、`auth.users`の行を持ち、サインインできない。

ラウンド・距離・矢の変更は専用のイベントRPCだけを経由する。RPCはクライアントから受け取った識別子を権限判定の根拠としてそのまま信用せず、対象の親関係から実際のラウンドを特定し、`auth.uid()`がそのラウンドの`editor`であることを確認する。`author_id`もRPC内で`auth.uid()`から設定する。権限確認、イベント追記、`revision`採番、射影更新は同一トランザクションで行い、確定した`revision`を返す。

書き込みRPCの拒否は2種類で、認可の拒否は`PT403`、契約の不一致(引数の形や範囲の不正)は`PT422`である。`PTxyz`はPostgRESTがHTTPステータスxyzで返す独自のSQLSTATEで、Postgres自身のコード(権限不足の`42501`など)と区別できる。
業務規則(後勝ち、削除、不変条件、構成と矢の整合)で効かない操作・項目は、拒否せず受理して応答で返す。イベントには効いた項目だけを記録し、効かなかった操作・項目と拒否した操作はどこにも記録しない。
存在しない距離への操作は、認可より前に`MISSING`で効かないと返す。距離IDは端末が作る推測できないUUIDで、他のラウンドの情報は漏れない。存在する距離への権限の無い呼び出しは`PT403`で拒否する。
履歴の取得の関数`rounds_list`・`distances_list`と、それらが対象のラウンドとして読む`history_rounds`は、呼び出し元の権限で動く(`SECURITY INVOKER`)読み取り専用の関数で、認可はSELECTのRLSに従う。実行権限は`authenticated`だけが持つ。引数は検証せず、返るのは呼び出し元が属するラウンドだけである。
`history_rounds`だけは、呼び出し元へ展開させるため`SET search_path`を付けず、本文の表と関数の名前を修飾する。`SECURITY INVOKER`の読み取り専用で、`search_path`を変えられても権限は上がらない。
`shot_fits`(矢がラウンド構成で有効かの判定)は、`PUBLIC`・`anon`・`authenticated`の実行権限を持たない内部関数である。
