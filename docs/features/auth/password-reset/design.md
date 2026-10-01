# auth/password-reset 設計

## 概要

メールアドレス、認証コード(OTP)、新しいパスワードの3段階を、`/reset-password`の中で進める。
`resetPasswordForEmail`でコードを送り、`verifyOtp`(type: recovery)で確認し、`updateUser`でパスワードを変える。
変更後はサインアウトして`/signin`へ移り、自動ではサインインしない。
送信と再送にはTurnstileを使い、`verifyOtp`には使わない。
サインアップと同じ構造にそろえている。

## 画面と状態

状態は`reset-password-flow.ts`のreducerが持つ。

| 状態 | 表示 | 次の状態 | 要求 |
| --- | --- | --- | --- |
| メール入力 | メールアドレス、captcha、送信、サインインへのリンク | 送信成功でコード入力、リンクで`/signin`、検証・送信失敗はエラー表示、送信中は送信ボタンを無効にする | password-reset-01, 02, 08, 13, 15 |
| コード入力 | 認証コード、確認、再送、戻る。迷惑メールの確認を案内する | 確認成功でパスワード設定、戻るでメール入力、再送、確認・再送の失敗はエラー表示、処理中は3つのボタンを無効にする | password-reset-03, 04, 05, 07, 10 |
| パスワード設定 | 新しいパスワード(表示切替つき)、変更 | 成功でサインアウトして`/signin`、検証・変更失敗はエラー表示、処理中は変更ボタンを無効にする | password-reset-06, 11 |

- コード入力では、確認・再送・戻るが互いに排他である。
- 再送にはクールダウンがあり、中の再送はエラーを表示する。

## 構成とデータの流れ

- `src/app/(auth)/reset-password/page.tsx`: サーバー側。レイアウトのみ。
- `src/app/(auth)/reset-password/reset-password-form.tsx`: 段階ごとのフォームと送信。
- `src/app/(auth)/reset-password/reset-password-flow.ts`: 段階、エラー、コード入力の処理中を持つreducer。
- `src/app/(auth)/reset-password/validate.ts`: メールアドレス、コード、パスワードの検証。
- `src/features/auth/errors.ts`: エラーコードを日本語にする。

契約は次のとおりである。

- メールアドレスは254文字以内、コードは6桁、パスワードは半角英数字と記号で8〜72文字である。
- パスワードが英字と数字を含む要件は、Supabaseの`password_requirements`とその翻訳が担う。
- captchaトークンは再送のたびに消費されるため、毎回取り直す。
- 再送の間隔は`max_frequency`で、productionとpreviewは60秒、ローカルとCIは1秒である。
- パスワード変更後は`signOut()`し、`window.location.assign("/signin")`で遷移する。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| --- | --- | --- |
| マジックリンクでなくOTPを使い、メールのテンプレートを差し替える | 同じ画面の中でコードを入力して完結できるため | メール到達の問題が解消されたとき |
| 変更後はサインアウトして`/signin`へ移り、自動サインインしない | 再設定後に改めて本人確認できるため | 再設定後の自動サインインを要求に加えるとき |
| 確認・再送・戻るを排他にする | 並行操作で状態が壊れたため、確認中と再送中を独立させる方式をやめた。詳細: #545 | 応答を世代管理する方式にするとき |
| ネイティブの`disabled`、`required`、`minLength`を使わず、クライアント検証と`aria-disabled`と同期refを使う | 理由を利用者へ伝え、E2Eでの二重送信を防ぐため | 検証の理由を別の方法で利用者へ伝えるとき |
| メールアドレス、コード、パスワードの長さを`maxLength`でなく送信時に検証する | Playwrightの`fill()`が`maxLength`で切り詰めるため。サインインのパスワード欄には適用しない | パスワード規則を変えるとき |
| 認証済みのリダイレクトを`reset-password-form.tsx`に置く | `page.tsx`をサーバー側だけにするため | ガードを`proxy.ts`へ集約するとき |
| captchaは送信と再送に適用し、`verifyOtp`には適用しない | ボットによるメール送信の濫用を防ぐため。テスト用キーは、previewのドメインを事前登録できないため | captchaの方式を変えるとき |
| 水和の完了を`data-hydrated`、captchaの準備を`data-captcha-ready`で示す | E2Eの水和競合を防ぐため | E2Eが水和とcaptchaの準備を別の方法で待てるとき |

## 制約と未対応

- 変更後の遷移には、`router.push`でなく`window.location.assign`によるハードナビゲーションを使う。
- 再送のクールダウンは、再送の開始時に始まる。
