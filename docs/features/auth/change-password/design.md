# auth/change-password 設計

## 概要

`/settings/password`で、サインイン済みの利用者が現在のパスワードと新しいパスワードを入力して変更する。
現在のパスワードの確認は認証サービスが行う(`[auth.email] require_current_password = true`)。
画面を使わない直接呼び出しも拒否する(本番で有効であることが前提)。
更新は、この端末の接続の`updateUser({ password, current_password })`の1回で行う。
別の接続での確認も、Turnstileも使わない。
他の端末の終了は認証サービスの挙動に依拠し、別のサインアウト処理を持たない(`docs/features/auth/design.md`)。
認証コード由来のセッション(amr=otp)は、この検査を免除される。
登録の完了時にパスワードで確かめたセッションへ置き換え(`docs/features/auth/signup/design.md`)、この画面はセッションの種類を判定しない。
画面の枠(`/__shell/settings/password`)をオフライン用に保存し、送信は直前にオフラインを判定して拒否する。

## 画面と状態

| 状態 | 表示 | 次の状態 |
| --- | --- | --- |
| 初期 | 現在のパスワード、新しいパスワード(どちらも表示切替つき)、変更 | 送信で処理中 |
| 検証エラー | 未入力・規則違反を欄ごとに表示する | 再送信 |
| 処理中 | 変更ボタンを`aria-disabled`にする。以前のエラーと完了の表示は開始で消す | 成功で完了、失敗でエラー |
| オフライン | 入力に不備が無いとき、オフラインの文言を全体のエラーに表示する。更新しない | 再送信 |
| 失敗(通信の断を含む) | 理由を表示し、入力値を保つ | 再送信 |
| 完了 | 完了の文言を表示する。入力値を消す。この端末はサインイン済みのまま、画面に留まる | 再送信 |

- 現在のパスワードの誤り(`current_password_invalid`)は、「現在のパスワードが正しくありません。」で示す。
  サインインの`invalid_credentials`とは別の種類である。
  同じパスワードの拒否(`same_password`)も別の種類で示す。
- 画面の作りは、認証の画面と同じにする(中央寄せ、`max-w-sm`、見出し`h1`は`font-heading text-2xl leading-snug font-medium`)。
  `main`は`mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-4 p-8`で、画面の上下中央にそろえる。
  `(main)`のレイアウトの本文の領域(`min-h-0 min-w-0 flex-1 overflow-y-auto`)の中に置くため、`min-h-full`で領域の高さいっぱいに広げ、`justify-center`で上下中央にする。
  内容が領域より高いときは、`min-h-full`により`main`が伸びて領域がスクロールし、上端が切れない。
  認証のレイアウト(`app/(auth)/layout.tsx`)は、ロゴの分(`mt-14`、`h-[calc(100dvh-3.5rem)]`)を持つため使わず、同じ中央寄せを画面の`main`に持たせる。
  エラーと完了の文言は、`text-center text-sm`で、エラーは`text-destructive`である。
  入力欄(`Input`)と変更ボタン(`BusyButton`)は既存の部品のままである。
- キャプション(placeholder)は、現在のパスワードが「現在のパスワード」、新しいパスワードが「新しいパスワード」だけである。
  新しいパスワードのキャプションには、規則の文を含めない。
  規則(8〜72文字の半角英数記号で、英字と数字を含む)は、違反したときの理由(`weak_password`と入力の誤り)で示す。
  サインアップと再設定のキャプション(`passwordFieldPlaceholder`)は変えない。
- 新しいパスワードは1回の入力で、確認用の欄を持たない。
  入力欄の用途は`autocomplete`(`current-password`、`new-password`)で区別する。
- 完了の表示は、再読み込みや別の画面への移動の後は出ない。
- 完了を伝える領域(`role="status"`)は常に描画し、完了の文言だけを差し込む。
  後から挿入された領域は、読み上げられない場合があるためである。
- 完了で作り直すのは2つの入力欄だけで、フォームと送信ボタンは残す。
  完了後も、送信ボタンのフォーカスは保たれる。
  入力欄は制御せず、値は送信時にDOMから読む。

## 構成とデータの流れ

構造の方針は`docs/architecture.md`に従う。

- `supabase/config.toml`: `[auth.email]`に`require_current_password = true`を足す。
  `secure_password_change`は足さない(無効のまま)。
  本番への反映は`supabase config push`による(`[remotes.*]`は上書きしない)。
- `src/app/(main)/settings/password/page.tsx`: 入口。
  認証の実装、`Connectivity`、手続きを生成して画面へ渡す。サイトキーは要らない。
- `src/features/auth/ui/change-password-form.tsx`: 画面。
  状態を`useScreenView`で持ち、完了で入力欄を作り直して消す。文言は`ui/auth-messages.ts`から得る。
- `src/features/auth/application/change-password.ts`: 手続きと、約束(`ChangePasswordAuthenticator.updatePassword({ currentPassword, newPassword })`)。状態を持たない。
  `createChangePassword({ authenticator, connectivity })`が`ChangePassword`(`submit(input, view)`)を返す。
- `src/features/auth/domain/change-password-flow.ts`: 集約。開始の命令(`beginChangePassword`)が、送信中、入力の判定、オフラインの判定の順を守る。
  `ChangePasswordFlow`は、`submitting`、`fieldErrors`、`error`、`completed`(直前の送信が完了したか。次の開始で消える)、`completions`(完了の回数。画面が入力欄を作り直すkeyに使う)を持つ。
  事実(`changePasswordReducer`)は`changed`(受け付けられた)と`failed`(拒否も通信の断も)で、初期値は`initialChangePasswordFlow`である。
- `src/features/auth/domain/password.ts`、`auth-failure.ts`、`flow.ts`: 失敗の種類に`current_password_invalid`と`same_password`、入力の誤りの欄に`currentPassword`(未入力のみ)と`newPassword`(未入力・規則違反)を足す。
- `src/features/auth/infrastructure/supabase-auth.ts`: `updatePassword`を足し、応答のコードを専用の対応で写す(下表)。
  再設定とサインアップの`setPassword`の写しには、`same_password`だけを足す(`docs/features/auth/signup/design.md`)。
- `src/features/settings/ui/settings-screen.tsx`、`src/routes.ts`、`src/app/sw.ts`: 「パスワード変更」項目のリンク、`CHANGE_PASSWORD_PATH`と`FRAME_PATHS`、枠の判定の1分岐。
  保護と遷移元は`/settings`の配下で、`proxy.ts`と`auth-routes.ts`は変えない。
  レフトパネルは経路の完全一致で`aria-current`を付けるため、`/settings/password`ではどの項目にも付かない(許容する)。

流れは次のとおりである。

1. 送信の直前にオフラインを1回読む。
   入力判定 → オフライン判定の順に判定する。
2. 通れば、更新を1回呼ぶ。
   現在のパスワードは認証サービスが検証し、誤りなら更新しない。
   更新が成功した場合だけ、他の端末のサインインが終わる。
3. 応答の後、画面が表示中のときだけ、状態を更新する。
   離れていても、更新の呼び出しは進める。

### 応答の写し

| 認証サービスの応答 | 失敗の種類 | 表示 |
| --- | --- | --- |
| 400 `current_password_invalid` | `current_password_invalid` | 「現在のパスワードが正しくありません。」 |
| 422 `same_password` | `same_password` | 現在のパスワードと同じにはできない旨 |
| 422 `weak_password` | `weak_password` | 既存のパスワードの規則の文面 |
| 400 `validation_failed` | `weak_password` | 同上(72バイト超など) |
| `over_request_rate_limit` | `rate_limited` | 既存の制限の文言 |
| 通信の断、呼び出しが投げた | `unreachable` | 既存の通信エラーの文言 |
| 400 `current_password_required`、その他 | `other` | 既存の汎用の文言 |

- 表にないコードは`other`で、`REJECTION_KINDS`は継がない。
  コードの意味と検証順は`docs/features/auth/design.md`に従う。
- `current_password_required`は、画面が未入力を送らないため通常は起きない。
  起きたときは設定や実装の不整合で、汎用の失敗として示す。
  `current_password_invalid`とメッセージが同文のため、写しは必ずコードで行う。
- 画面が送信前に判定する新しいパスワードの規則は、未入力と文字種だけである。
  長さと英字・数字は認証サービスの`weak_password`に委ねる。
- 要件の「新しいパスワードの長さや強さの規則違反は…現在のパスワードの正誤は示されない」は、認証サービスが新しいパスワードを現在のパスワードより先に検証することに依る(実測の順は`docs/features/auth/design.md`)。
  現在のパスワードが未入力で新しいパスワードが短いときは、画面は未入力だけを示し、短さは送信後の応答で示す。
  要件の「理由が全て表示される」は、画面が判定できる不備に限る。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| --- | --- | --- |
| 現在のパスワードの確認を認証サービスに強制させる(`require_current_password`) | 画面の手順を回避した直接呼び出しも防げる。確認が更新の1回の呼び出しになり、別の接続も、Turnstileも、確認用セッションの後始末も要らない。OWASP Authentication Cheat SheetとASVS 2.1.6が、パスワード変更に現在のパスワードの確認を求める | 認証サービスの版が設定を持たなくなったとき、または本番で効かないとき |
| 認証コード由来セッションの免除は、画面でなく、登録時のセッションの置き換えで塞ぐ | この画面を1回の呼び出しのまま保ち、検査をサーバー強制のまま使うため。画面でセッションの種類を判定しても、直接呼び出しは防げない。変更時の自動サインインは採らない | 認証サービスが免除をやめたとき |
| `secure_password_change`(メールの認証コード)を有効にしない | 現在のパスワードとコードの両方を要する構成は採らない。コードだけでは、作成から24時間以内のセッションが無検査になり、一般的な実装より弱い(`docs/security.md`) | 本人確認の強化をchange-email等と合わせて扱うとき |
| チェック(Turnstile)を使わない | 更新の呼び出しがチェックを検証しない(実測)。画面にチェックを置いても、直接呼び出しは抑止できない | 認証サービスが更新にもチェックを要するようになったとき |
| 現在のパスワードの誤りを、サインインの`invalid_credentials`と別の種類にする | コードが別で、サインインの失敗の文言と混ぜないため。この画面の文面だけを持つ | なし |
| 同じパスワードを認証サービスの拒否(422 `same_password`)で判定し、画面で比べない | 判定の持ち主を認証サービスの1つにするため。更新の応答が失われた後の再試行も、同じ文言になる | なし |
| 他の端末の終了を実装せず、認証サービスの挙動に依拠する | 更新を呼んだセッション以外が終わるため(実測)。別のサインアウトを足すと、更新の応答が失われた場合の保証と矛盾する | 認証サービスの挙動が変わったとき |
| 更新の失敗を、区別せず通信の失敗として扱う(打ち切りも設けない) | 既存の認証と同じ扱いに揃えるため。更新の結果が不明な場合の保証は置かない | 通信が止まった画面を問題にするとき |
| アプリ側の試行回数の制限を設けない | 画面の回数制限は、サインイン済みのセッションを持つ者の直接呼び出しを抑止しない。既存の認証と同じ扱い | 認証サービスの制限が無いと確認されたとき(「制約と未対応」) |

## 制約と未対応

- 更新の応答が失われた場合、更新は成功していることがある。
  この端末の維持と他の端末の終了は保証しない。
  変更前のパスワードを現在として再試行すると「現在のパスワードが正しくありません。」を示す。
  新しいパスワードを現在として再試行すると、新しいパスワードの欄も同じ値のときだけ、同じパスワードの拒否を示す(別の値なら成功する)。
- 現在のパスワードの総当たりの抑止は保証しない(ローカルで約240回の誤りでも429が出ない)。
- `require_current_password`が本番で効かないと、検査なしに更新が成功し、画面から検知できない。
  ローカルのE2Eで、現在のパスワードなしの更新が拒否されることを確かめる。
  設定の値(`secure_password_change = false`、`require_current_password = true`)を確かめる単体テストがある。
- 残余リスク(認証コード由来のセッションの免除、他の端末の最大約1時間の読み書き)は`docs/security.md`に従う。画面は検知しない。
- 拒否(現在のパスワードの誤り・必須、規則違反)の後も、他の端末が維持されることは、ローカルで実測した。
  E2Eの確認項目は`docs/features/auth/signup/design.md`に従い、この画面では、一方の端末で現在のパスワードの誤りを送り、他方の端末が維持されることも確かめる。
- 盗まれたセッションの悪用への備えは、後続のchange-emailとdelete-accountの本人確認と合わせて扱う。
