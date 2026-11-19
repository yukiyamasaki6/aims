# auth 共通設計

## 概要

メールOTPで登録・サインインし、パスワードの設定・変更・再設定を提供しない。
登録とサインインの入口は分け、送信・確認の手続きと画面を共通化する。
削除は標準OTPの直近60秒の認証で認可し、通常ログインの認証も利用する。
利用者の認証APIへの接続は`infrastructure/supabase-auth.ts`へ集約し、入口が実装を生成して注入する。

## 構成とデータの流れ

以下の`src/`は`apps/web/src/`からの相対である。

| ファイル | 責務 |
| --- | --- |
| `src/features/auth/domain/email-otp-flow.ts` | メール/コード段階、送信/確認の排他、入力・通信可否・CAPTCHA・再送待機の規則 |
| `src/features/auth/application/email-otp.ts` | 共通の`sendCode`・`verifyCode`・`tickCooldown`と、認証IOの約束。登録可否と完了処理を受ける |
| `src/features/auth/application/sign-in.ts` | 登録を許可しないOTP手続きと、安全な遷移元への完了処理を生成する |
| `src/features/auth/application/sign-up.ts` | 登録を許可するOTP手続きと、ホームへの完了処理を生成する |
| `src/features/auth/infrastructure/supabase-auth.ts` | SDKのOTP送信/確認、利用者取得、メール変更、セッションIO、応答の内側への変換 |
| `src/features/auth/ui/email-otp-form.tsx` | メール/コードの共通画面。`otp-email-step.tsx`・`otp-code-step.tsx`を利用する |
| `src/features/auth/ui/signin-form.tsx` | サインイン用の文言・遷移元の読み出しを共通画面へ渡す |
| `src/features/auth/ui/signup-form.tsx` | 登録用の文言・手続きを共通画面へ渡す |
| `src/features/auth/domain/auth-code.ts` | 6桁の入力上限、コード未入力の検査、60秒の再送待機 |
| `src/features/auth/domain/auth-routes.ts` | 認証ガード、許可する遷移元、既定の行き先。経路文字列は`src/routes.ts`が持つ |
| `src/features/auth/domain/auth-failure.ts` | 文言を持たない失敗の種類。`otp_required`は削除の再確認不足を表す |
| `src/features/auth/application/call-result.ts` | IOの受理・失敗の結果。認証サービスの文言は表示しない |
| `src/features/auth/ui/use-screen-view.ts` | 状態と`ScreenView`、表示中の判定、チェック部品の参照 |
| `src/features/auth/domain/captcha-token.ts` | チェック完了・待機・解除の規則 |
| `src/features/auth/ui/use-check-wait.ts` | 押した時点の入力を保持し、トークン到着後に同じ操作を再開する |
| `src/features/auth/ui/turnstile.tsx` | トークン・失敗・追加チェックを通知し、追加操作のない待機の10秒上限を計る |
| `src/features/auth/ui/auth-messages.ts` | 入力不備・認証失敗・再送・削除再確認の利用者向け文言 |
| `supabase/config.toml` | Auth発行制限Hook、メール確認必須、6桁・900秒、送信・検証制限、CAPTCHA |

入口はClock・Connectivity・PageReplaceと認証実装を注入し、uiとinfrastructureを互いに依存させない。
SDKのセッション・JWT・エラーの語彙はinfrastructureで内側の型へ変換する。
登録は`signInWithOtp`の`shouldCreateUser:true`、ログインと削除時の再確認は`false`を指定し、確認は`verifyOtp({email, token, type:'email'})`を使う。
メールを入力できる登録/ログインでは、送付先を確認まで保持し、戻るとメールを残してコードを消す。
未登録ログインの既知の拒否だけを送付受理と同じ表示にし、CAPTCHA・制限・通信障害は失敗として示す。
メール確認後はそのOTPセッションを使い、パスワード設定・パスワードによるセッション置換・他セッションの一括終了を行わない。

### 認証サービスの発行制限

Custom Access Token Hookは`event jsonb -> jsonb`のSECURITY INVOKER関数とする。
今回の発行方式が`otp`・`token_refresh`・`email_change`ならclaimsをそのまま返し、password・その他・欠落なら403で発行を拒否する。
`amr`にpasswordが残る既存セッションも、今回の方式がtoken_refreshなら更新を許可する。
関数と必要なschemaの権限は`supabase_auth_admin`にだけ付与し、PUBLIC・anon・authenticatedの実行を拒否する。
ハッシュ・セッション・利用者IDを書き換えず、署名鍵・Cookie名・セッション期限も変更しない。
直接のパスワード更新要求そのものは追加で禁止しないが、更新後もHookでパスワードによる新規認証を拒否する。
メールはコード・15分の期限・心当たりがない場合の案内を示し、認証成立リンクやパスワード操作への導線を持たない。
confirmation・magic_link・recoveryは共通の`supabase/templates/email-otp.html`を使い、旧用途別のsignup.html・already-signup.html・reset-password.htmlは廃止する。
`/reset-password`のページ・ルート・定数・ガード対象を削除し、互換リダイレクトを設けない。

### チェック・失敗・離脱

開始の命令`begin*`は、実行中→入力不備→オフライン→チェックの順に検査し、開始できるときだけ依頼を返す。
コード送付・再送だけがCAPTCHAを使い、成否によらず消費後に取り直す。確認と削除RPCはCAPTCHAを使わない。
未完了で押したときはエラーにせず待機し、追加チェックの間は待ち、トークン到着で再開する。
失敗または追加チェックのない10秒上限で待機を解除し、再押下では再度待つ。
チェック欄は追加操作・失敗で展開し、完了後もresetまで保持する。resetだけで畳み、新しい段階は畳んで開始する。
チェックの失敗と処理失敗はフォーム全体の同じエラー欄へ表示し、再送の欄へは出さない。
オフラインでは通信も保留も行わず、入力とチェックトークンを保持する。
送信・確認・再送・戻るは相互に排他とし、同じ処理を重複開始しない。
離脱後は、その画面による表示・遷移を行わない。認証APIの成功で既に成立したセッションは取り消さない。
削除成功後の消去とサインアウト完了の遷移は、離脱後も進める。

### セッションの共通契約

サインイン状態の読み取りは、認証済み・未認証・unknownを返し、確認できないときに例外を投げない。
接続は利用時に取得し、ブラウザでは同じ接続を返す。接続不備のIOはunreachableへ変換する。
`SignInChanges.subscribe`だけは、接続取得時の同期例外を許す。
SIGNED_INと利用者のある起動時復元はuserId付きのsigned-in、SIGNED_OUTはsigned-outへ写し、TOKEN_REFRESHEDは通知しない。
削除時のOTP再確認もSIGNED_INを通知する。同じ利用者ならページを読み直さず、別利用者への切替は既存の見張りが記録を分離する。
サインアウトと削除はSessionEndFlowの排他を共有する。削除のネットワーク実行だけをholdEndで保持し、OTP入力の待ち時間は保持しない。
保持の上限は90秒で、遅れた結果は世代で無視する。削除応答後は計時を止め、完了のサインアウトは既存の10秒上限を使う。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| --- | --- | --- |
| 登録・ログインの入口を分け、2段階の処理を共通化する | 入口の目的と登録可否は異なるが、送信・確認・待機の規則は同じであるため | 入口ごとの操作が異なるとき |
| password-setupの共通処理をOTP用へ置換する | パスワード段階を持たず、同じ責務の仕組みを二重に残さないため | パスワードを再導入するとき |
| Authの発行Hookで方式を制限する | UIだけでは直接APIのパスワード認証を禁止できないため | Authの発行方式やHook契約が変わるとき |
| 削除の検証も標準Authへ委ねる | 直近の標準OTPを許す契約に従い、独自検証・署名鍵・単回許可を不要にするため | 削除用途の証明が必要になるとき |

## 制約と未対応

メールを受信できない場合の別の復旧手段、SMS・外部認証・MFAは扱わない。
`proxy.ts`はハッシュを見られないため、サインイン入口がブラウザに残ったハッシュを遷移元へ補う。
直接APIによるパスワード設定は保存値や他セッションに影響しうるが、パスワード認証は再開しない。詳細は`docs/security.md`に従う。
