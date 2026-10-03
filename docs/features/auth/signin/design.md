# auth/signin 設計

## 概要

登録済みのユーザーが、メールアドレスとパスワードでサインインする。
Supabase Authの`signInWithPassword`を、Turnstileのトークンを添えてブラウザから直接呼ぶ。
認証済みの`/signin`のリダイレクトは`proxy.ts`が担う。
成功時は送信中のまま、遷移元があればそこへ、無ければ`/rounds`へ遷移し、送信中を解除しない。
遷移元は、クエリ`returnTo`で渡された`/rounds`配下のパスに限る。

## 画面と状態

状態は`signin-flow.ts`のreducerが持つ。

| 状態 | 表示 | 次の状態 | 要求 |
| --- | --- | --- | --- |
| 初期 | 入力欄、サインイン、「パスワードをお忘れですか」「サインアップ」のリンク | リンクで`/reset-password`、`/signup` | signin-02, 03 |
| 検証エラー | メールアドレス、パスワード、captchaの順に最初の1件を表示する | 再送信でエラーが消え、新しいエラーが出る | signin-05, 08 |
| 送信中 | ボタンを`aria-disabled`にする | 成功で遷移元、無ければ`/rounds` | signin-01, 11, 12, 09 |
| 認証失敗、通信エラー | エラーを表示し、ボタンを再度有効にし、captchaを未完了に戻す | 再送信 | signin-10 |

- 認証済みで`/signin`を開くと、有効な遷移元があればそこへ、無ければ`/rounds`へ送る(signin-04, 13)。

## 構成とデータの流れ

- `src/app/(auth)/signin/signin-form.tsx`: フォーム本体と送信。
- `src/app/(auth)/signin/signin-flow.ts`: 状態遷移のreducer。
- `src/app/(auth)/signin/validate.ts`: 入力の検証。
- `src/features/auth/return-to.ts`: 遷移元の検証(`resolveReturnTo`)、クエリからの読み取り(`readReturnTo`)、遷移元付きの`/signin`のURL生成(`signInHref`)。純関数で、`proxy.ts`とクライアントの両方から使う。
- `src/features/auth/errors.ts`: エラーコードを日本語にする。未知のコードは元のメッセージを使い、`AuthRetryableFetchError`は通信エラーの文言にする。
- `src/lib/supabase/session.ts`: `proxy.ts`から呼ばれ、認証済みの`/signin`を、有効な遷移元があればそこへ、無ければ`/rounds`へ送る。

流れは次のとおりである。

1. 送信時に、メールアドレス、パスワード、captchaの順に検証する。
2. 通れば、`signInWithPassword`をトークン付きで呼ぶ。
3. 成功なら、送信時のURLの`readReturnTo`の結果、無ければ`/rounds`へ遷移する。失敗なら、エラーを翻訳して表示し、captchaをリセットする。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| --- | --- | --- |
| サインインをServer Actionでなく、クライアントから直接呼ぶ | 送信中に別の画面へ移動すると、Server Actionのリダイレクトと競合したため、Server Actionをやめた。詳細: #318 | 競合を避けられる方式が出たとき |
| ネイティブの`disabled`と入力欄の検証を使わず、`noValidate`と`aria-disabled`で表す | 空入力やcaptcha未完了の理由を利用者へ伝えるため | 理由を別の方法で利用者へ伝えるとき |
| 成功時は送信中を解除しない | 遷移までの二重送信を防ぐため | 遷移方式を変えるとき |
| アンマウント後は状態を更新しない | 送信中に画面を離れた場合の不整合を防ぐため | 状態を画面の外で持つ方式にするとき |
| サインインのパスワードに、サインアップのパスワード規則を適用しない | 規則の変更前に作った既存アカウントでも、サインインできるようにするため | 既存アカウントが規則を満たすことを確認できたとき |
| Turnstileを使い、ローカル、CI、previewでは常に成功するテスト用キーを使う | ブルートフォースを抑えつつ、E2Eを外部に依存させないため | captchaの方式を変えるとき |
| 遷移元を`/rounds`配下の許可リストで検証し、クエリ`returnTo`で渡す | 保護対象外の`/signin`へのループとオープンリダイレクトを同時に避け、保存を持たずURLだけで完結させるため | 保護対象の画面が`/rounds`の外にできたとき |
| 認証済みのリダイレクトを`proxy.ts`へ集約し、画面ごとのE2Eは残す | 実装を一箇所にまとめつつ、各画面の挙動を保証するため | ガードの実装を変えるとき |
| 状態遷移をreducerに分け、水和の完了を`data-hydrated`で示す | 遷移の規則を切り離し、水和前の操作によるE2Eの不安定さを避けるため | E2Eが水和を別の方法で待てるとき |

## 制約と未対応

- 再試行の回数制限は、captcha以外に設けていない。
- signup・reset-passwordを経由すると遷移元は引き継がない。
