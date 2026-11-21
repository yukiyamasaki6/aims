# auth/signin 設計

## 概要

`/signin`で新規・既存を区別せず、メールOTPを確認して利用を開始・再開する。
未登録なら登録し、既存なら元の利用者IDと記録を利用する。
送付と再送はTurnstileを使い、確認はAuthの検証制限を通す。
確認成功後と認証済みで開いた場合は、有効な遷移元またはホームへ進む。
Googleは、メール入力の段階の「Googleで続ける」から認証サービスのOAuth(PKCE)で行い、新規・既存を分けない。戻り先は`/signin?returnTo=<遷移元>`で、戻った`/signin`が`code`を交換し、OTPと同じ置き換えで遷移元へ進む。CAPTCHAは使わない。

## 画面と状態

| 状態 | 表示・操作 | 次の状態 |
| --- | --- | --- |
| メール入力 | 本文見出しなし。メール入力、「メールで続ける」、チェック | 送信受理でコード入力 |
| チェック待ち | 操作時点の入力を保持し、送信中と同じ表示 | 到着で送信、失敗・上限で解除 |
| コード入力 | 本文見出しなし。送付先、コード入力、「確認」、「戻る」、再送待機・迷惑メールの案内 | 確認成功で遷移、戻るでメール入力 |
| 処理中 | 送信/確認/再送/戻るを重複開始しない | 失敗は同じ段階へ、成功は遷移まで処理中 |
| 入力不備・オフライン・失敗 | 内側の種類に対応した理由を示す | 入力を保ち再試行 |

「メールで続ける」はメール入力段階の初回送付ボタンだけに使い、見出し・ヘッダー・再送・コード確認には使わない。
メール入力へ戻って再試行する場合も同じ送付ボタンを使い、既存の待機中の残り秒数表示は保つ。
未サインイン向けの共通ヘッダーを持たず、ヘッダー枠・下線・認証リンクを置かない。
サインインは既存のlogo.svgを高さ24pxでフォームの前に通常配置し、紹介「/」へのリンクにする。
ロゴはフォームとともにスクロールし、固定配置にしない。メール入力・コード入力の両段階で同じロゴを表示する。
ロゴのために新しいヘッダー部品やメニューを追加しない。
サインインのメール入力・コード入力の本文に見出しを置かず、コード段階の送付先の説明と戻る操作は維持する。
紹介・認証画面からログイン・登録の選択肢や相互リンクをなくし、認証への導線は`/signin`へ向ける。
紹介本文の先頭・末尾の「記録を始める」は文言を保って`/signin`へ向ける。
紹介画面の先頭・末尾の開始操作、保護経路のガード、セッション喪失と終了後の遷移から統合入口へ到達できるため、代替の認証リンクや新しい文言を設けない。
ロゴの配置に合わせた枠の調整を除き、フォームの入力支援、フォーカス、チェック表示は既存のものを使う。
新規専用の完了画面・案内・追加選択は設けず、両者とも確認後すぐに同じ規則で遷移する。
コード欄は`autocomplete=one-time-code`、メール欄はメールの自動入力に対応し、各段階のEnterは既存の送信・確認を実行する。
送付成功から60秒は再送を拒否して残り秒数を表示し、戻っても待機とメールを保持する。
コードの未入力だけを送信前に検査し、形式・期限・再使用の判定はAuthへ委ねる。

Googleの操作の状態は、OTPの集約と独立した集約`google-sign-in-flow.ts`(`running`、`error`)が持ち、OTPの送付を止めない。

| 状態 | 表示・操作 | 次の状態 |
| --- | --- | --- |
| Googleの初期 | メール入力の段階で、メールのフォームより上に「Googleで続ける」を置き、その下に区切り「または」、続いてメールのフォームを置く。Googleの失敗の文言は「Googleで続ける」の直下に示す。コード入力の段階には置かない | 押下でGoogleへの移動中。オフラインは「ネットワークに接続されていません。…」を示して留まる |
| Googleへの移動中 | ボタンが処理中。再押下は何もしない | Googleの画面へ移る。開始の失敗は「Googleでの認証に失敗しました。」を示して初期へ。bfcacheで戻ると初期へ |
| 戻りの交換中 | 読み込み後に`code`つきの戻りを読み、URLから戻りを外し、ボタンを処理中にする | 成功で遷移元、無ければ`/rounds`へページ全体を置き換える(処理中は解除しない)。交換の失敗(拒否・制限・通信)は「Googleでの認証に失敗しました。」を示して初期へ |
| 戻りの取り消し | `error=access_denied`(`error_code`なし)。URLから戻りを外し、何も示さない(失敗の種類も作らない) | 初期 |
| 戻りの失敗 | その他の`error`と、`error_code=identity_already_exists`(追加の戻りにだけ起こり、サインインでは起こらない経路)。失敗の種類`google_auth_failed`で「Googleでの認証に失敗しました。」。失敗の種類ごとの文は設けず、認証サービスの文言は出さない | 再押下 |

Googleの手段にだけ残るアドレス(どの利用者の`auth.users.email`でもなく、`auth.identities`のGoogleの手段にだけあるアドレス。メールアドレス変更の前のGoogleのアドレス、アカウントと異なるアドレスで追加したGoogleのアドレス)で「メールで続ける」を押したとき:

| 状態 | 表示・操作 | 次の状態 |
| --- | --- | --- |
| Googleを使う案内 | メール入力の段階に留まり、フォーム全体のエラー欄に「このメールアドレスはGoogleアカウントで登録されています。」を示す。コード入力へ進まず、再送の待機を始めない。入力したメールアドレスは保つ | 「Googleで続ける」、または別のアドレスで「メールで続ける」 |

- 判定: 認証サービスは、このアドレスの送付(`signInWithOtp`、`shouldCreateUser: true`)に422 `user_already_exists`を返し、メールを送らず、フックも呼ばない(実測)。インフラ層がこのコードを失敗の種類`google_only_address`に写す。写すのは統合入口の送付だけで、削除の再確認の送付(`shouldCreateUser: false`。現在のアドレスへ送るため起きない)とメール変更には足さない。
- 登録済み・未登録の通常のアドレスは、このコードにならない(実測。どちらも200)。この案内は、登録有無を知らせない方針の例外で、範囲はこのアドレスに限る(`docs/security.md`)。
- CAPTCHAのトークンは、送付の失敗と同じく消費し、取り直す(認証サービスはCAPTCHAを検証した後で重複を判定する。推)。
- 案内のための新しい送信の仕組み(メールの送信)は設けない。


## 構成とデータの流れ

以下のパスは`apps/web/src/`からの相対である。

| ファイル | 責務 |
| --- | --- |
| `app/(auth)/layout.tsx` | ヘッダーを持たず、紹介「/」へのリンク付き24pxロゴをフォームの前に通常配置する |
| `app/(auth)/signin/page.tsx` | Auth・Clock・Connectivity・PageReplaceを生成し、送信時の遷移元読み出しを画面へ渡す |
| `features/auth/application/sign-in.ts` | `createSignIn`が`shouldCreateUser:true`で共通OTP処理を生成し、確認後に`destinationOf(from)`へ置換する |
| `features/auth/application/email-otp.ts` | 送信・確認・再送待機の共通手続きと認証IOの約束。削除用の登録可否の指定も維持する |
| `features/auth/domain/email-otp-flow.ts` | 段階・入力・通信可否・チェック待ち・排他の規則 |
| `features/auth/ui/signin-form.tsx` | 手続きと未検証の遷移元を共通画面へ渡す。見出し用の文言は渡さない |
| `features/auth/ui/email-otp-form.tsx` | 見出しを持たない共通の2段階画面と既存OTP部品への接続。EmailOtpCopyのemailTitleを持たない |
| `features/auth/ui/otp-email-step.tsx` | 見出しとtitle引数を持たず、メール入力と送付を描く。送付ラベルに専用の`emailContinue`を使う |
| `features/auth/ui/otp-code-step.tsx` | 本文見出しを描かず、従来の戻る操作と送付先の説明を直接描く。確認・再送・チェックの振る舞いを保つ |
| `features/auth/ui/auth-messages.ts` | `emailContinue`に「メールで続ける」を持ち、不要になる`signInTitle`・`signUpTitle`・`otpTitle`を持たない。`otpSendCode`はメール変更用の既存文言として維持する |
| `features/auth/infrastructure/supabase-auth.ts` | `signInWithOtp`へ指定の登録可否を渡し、`verifyOtp`のtype:emailと結果を内側の型へ変換する。登録を許す送付の`user_already_exists`を`google_only_address`に写す。Googleの`signInWithOAuth`と`exchangeCodeForSession` |
| `features/auth/domain/auth-routes.ts` | `/rounds`配下のパス・クエリ・ハッシュだけを遷移元に許可し、認証済みの`/signin`に同じ行き先を適用する |
| `features/auth/ui/google-sign-in-section.tsx`、`google-button.tsx` | 「Googleで続ける」とその失敗の文言、続く区切り「または」(メールのフォームより上に置く。`otp-email-step`/`email-otp-form`がメール入力の段階の先頭に差し込む)、Googleの集約の状態と表示。押下と戻りの時点で、画面から受けた読み出し(戻り先`returnPath = signInHref(from)`、行き先`destination = from`)を呼ぶ。読み込み後に1回`resume`する。`use-page-restore`で`restored`を送る |
| `features/auth/application/google-sign-in.ts` | `start`(オフラインの判定、`startGoogleSignIn`)と`resume`(戻りの読み取り、URLの後始末、交換、置き換え)。約束`GoogleSignInAuthenticator`(`startGoogleSignIn({ returnPath })`、`exchangeGoogleCode(code)`)、`PageAddress`、`PageReplace`、`Connectivity` |
| `features/auth/domain/google-sign-in-flow.ts` | `beginGoogleSignIn`(実行中 → オフライン)、`beginGoogleReturn`、事実`failed`・`restored` |
| `routes.ts` | 認証入口の定数は`SIGN_IN_PATH`だけを持つ |
| `proxy.ts` | matcherは`/signin`と`/rounds/:path*`とし、既存の認証ガードを呼ぶ |
| `components/logo-image.tsx` | 既存のlogo.svgを使う。紹介用の拡大によって他の利用画面の既定サイズを変えない |
| `components/screen-messages.ts` | `headerSignIn`・`headerSignUp`を持たない |
| `features/introduction/ui/start-button.tsx` | 既存の静的リンクを`SIGN_IN_PATH`へ向ける |

`app/(auth)/signup/page.tsx`・`application/sign-up.ts`・`ui/signup-form.tsx`とその専用の公開型・関数を持たない。
`ui/auth-header.tsx`を持たない。戻るはメール変更で使う既存のボタン表現に合わせ、処理中の無効化と動作を維持する。
`auth-routes.ts`の`SIGN_UP_PATH`参照、旧登録用のguest-only判定と既定遷移の分岐を持たない。
存在しない経路への通常動作を使い、`/signup`の別名・転送・専用ガードやクエリ・ハッシュの救済を追加しない。
遷移元は送信時にURLから読み、returnToがハッシュを持たない場合だけ現在のハッシュを補う。
描画時にはブラウザURLを読まず、静的な事前描画を保つ。
送付時点のメールと確認するメールを一致させ、変更した場合はコード入力をやり直す。
確認後は既存の`window.location.replace`で1回だけページ全体を読み込み、成功時は送信中を解除しない。
登録有無の事前照会・独自DB更新・記録移行を行わず、Authの標準OTPを使う。
Googleでの認証では、認証サービスが、Googleの手段が結び付いた利用者、または確認済みの同じメールアドレスの利用者(自動結合)に入れ、どちらも無ければ作る。画面は新規・既存を区別しない。
交換の成功の`SIGNED_IN`で、端末の識別情報とアカウントの概要が書かれる(`../design.md`)。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| --- | --- | --- |
| 既存の`createSignIn`に登録許可を集約する | 登録側の許可とログイン側の復帰を組み合わせれば実現でき、新しい処理や入口名を増やす必要がないため | 認証方式の要求が変わるとき |
| 遷移元を完了時にも検証する | 外部URLへの遷移を防ぎ、クエリと設定表示のハッシュを保つため | 保護対象の経路が変わるとき |
| Googleの戻り先を`/signin?returnTo=…`にし、`/signin`が明示して交換する | 取り消しの後に同じ画面へ戻り、遷移元の規則をそのまま使えるため。Route Handlerで交換する案は、サーバー専用のコードと失敗の表示の経路が増えるため採らない | サーバーで交換する必要が出たとき |
| 削除時の登録禁止と既知の拒否の変換を維持する | 統合入口の変更を削除の再確認へ波及させないため | 削除の再認証契約が変わるとき |

## 制約と未対応

メールOTPの発行・確認の共通契約と離脱の扱いは`../design.md`に従う。
メールを受信できない場合の別の復旧経路、パスワード設定、他セッションの一括終了を追加しない。
Googleで作ったアカウントにも、`auth.users.email`(Googleのアドレス)へのOTPでサインインできる(認証サービスの仕様。実測)。
ホーム画面に追加したアプリ(スタンドアロン)では、Googleの画面が別の閲覧の文脈で開き、戻りがアプリの保存先に届かない端末がありうる。プレビュー環境で確かめる。

実装時は機能テストに進む前に、ビルドを含む`pnpm preview`（port 3000）でメール入力・コード入力のロゴとフォームを表示し、ユーザーが見た目を確認する。
