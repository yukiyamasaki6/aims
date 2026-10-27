# auth/signin 設計

## 概要

`/signin`で登録済みのユーザーが、メールアドレスとパスワードでサインインする。
Supabase Authの`signInWithPassword`を、Turnstileのトークンを添えてブラウザから直接呼ぶ。
認証済みの`/signin`のリダイレクトは`proxy.ts`が担う。
成功時は送信中のまま、遷移元があればそこへ、無ければ`/rounds`へ遷移し、送信中を解除しない。
遷移元は、クエリ`returnTo`で渡された`/rounds`配下のパスに限る。

## 画面と状態

状態は集約`sign-in-attempt.ts`が持つ。状態の遷移は`reducer`(`signInReducer`)で、現在の値は画面が最新の値の`ref`と描画用の`useState`で持ち、手続き`sign-in.ts`は最新の値を返すゲッターと`dispatch`を受け取って出来事を送り、順序を持つ。

| 状態 | 表示 | 次の状態 |
| --- | --- | --- |
| 初期 | 入力欄、サインイン、「パスワードをお忘れですか」「サインアップ」のリンク | リンクで`/reset-password`、`/signup` |
| 検証エラー | メールアドレス、パスワード、captchaの順に最初の1件を表示する | 再送信でエラーが消え、新しいエラーが出る |
| 送信中 | ボタンを`aria-disabled`にする | 成功で遷移元、無ければ`/rounds` |
| 認証失敗、通信エラー | エラーを表示し、ボタンを再度有効にし、captchaを未完了に戻す | 再送信 |

- 認証済みで`/signin`を開くと、有効な遷移元があればそこへ、無ければ`/rounds`へ送る。

## 構成とデータの流れ

構造の方針は`docs/architecture.md`に従う。

- `src/app/(auth)/signin/page.tsx`: 画面の入口。認証の実装(接続を作る関数`createClient`を渡す)、遷移の実装、手続きを生成し、手続きを画面へ渡す。
- `src/features/auth/ui/signin-form.tsx`: フォームの描画。状態を`useScreenView`で持ち、入力欄は`value`と`onChange`で制御する。送信時に手続きへ入力と画面の約束(`ScreenView`。最新の状態を返すゲッター、`dispatch`、`resetCheck`、`isMounted`)を渡す。失敗の後に、手続きの頼み(`resetCheck`)でウィジェットをやり直す。
- `src/features/auth/application/sign-in.ts`: 手続き。状態を持たず、`dispatch`へ出来事を送る順序(送信の可否と入力の検証の判定、送信、照合、離脱の判定、失敗とチェックのやり直し、または遷移)と、サインインの照合の約束(`SignInAuthenticator`)を持つ。
- `src/features/auth/domain/sign-in-attempt.ts`: 集約。出来事(`verified`、`invalid`、`submitted`、`failed`)で状態を遷移させ、送信の可否と入力の検証の順序(`checkSignIn`の1回の評価)、失敗の後の状態、captchaトークンの消費を守る。
- `src/features/auth/domain/email-address.ts`: メールアドレスの規則(値オブジェクト)。サインアップとパスワード再設定は、同じ機能の中から相対パスで使う。
- `src/features/auth/domain/auth-failure.ts`: 認証の失敗の種類(登録済み(`already_registered`)を含む)と利用者向けの文言(値オブジェクト)。認証サービスの語彙は持たない。
- `src/features/auth/domain/captcha-token.ts`、`password-input.ts`: セキュリティチェックのトークンと、パスワードの入力の規則と文言(値オブジェクト)。サインアップとパスワード再設定は、同じ機能の中から相対パスで使う。
- `src/features/auth/domain/return-to.ts`: 遷移元の規則(値オブジェクト)。許可するのは`/rounds`配下の同一オリジンのパスだけ。遷移元付きの`/signin`のURL生成(`signInHref`)と、クエリからの読み取り(`readReturnTo`)も持つ。純関数で、`proxy.ts`とクライアントの両方から使う。
- `src/features/auth/index.ts`: 認証の機能の入口。ドメイン層の関数と定数(`NETWORK_ERROR_MESSAGE`、`readReturnTo`、`signInHref`)を、別名なしで再公開する。
- `src/features/auth/infrastructure/supabase-authenticator.ts`: `signInWithPassword`の呼び出し。接続は、渡された関数で照合のたびに取得する。エラーは`toAuthFailure`で失敗の種類に写し、例外(接続を作れない場合を含む)は届かない失敗に変える。
- `src/features/auth/infrastructure/supabase-auth-failure.ts`: 認証サービスのエラー(通信の断を含む)を失敗の種類に写す(`toAuthFailure`。通信の断は名前で先に判定する)。エラーから直接文言を得る`authErrorMessage`も持つ。
- `src/features/auth/infrastructure/browser-navigation.ts`: 現在のURLからの許可された遷移元の読み出し(`readReturnTo`)と、routerによる遷移。
- `src/features/auth/ui/use-screen-view.ts`: 画面の状態を持つ汎用のフック。`reducer`で遷移させる状態を、最新の値の`ref`と描画用の`useState`で持ち、画面の約束`ScreenView`を作る。
- `src/features/auth/application/navigation.ts`: 画面の遷移と遷移元の読み出しの約束。機能の他の操作も使う。
- `src/features/auth/application/screen-view.ts`: 手続きが画面に頼む約束。出来事を送った直後の最新の状態を返す契約をここに書く。
- `src/components/turnstile.tsx`: Turnstileの共通部品。`interaction-only`で描画し、操作が必要な間だけ領域を出し、それ以外は畳む。未完了のエラー文言も表示する。サイトキー(環境変数`NEXT_PUBLIC_TURNSTILE_SITE_KEY`)は自分で読む。
- `src/components/auth-header.tsx`: 認証画面の見出し。
- `src/lib/supabase/client.ts`: ブラウザの接続。
- `src/hooks/use-mounted-ref.ts`: 画面がマウント中かどうかの参照。画面が`isMounted`として手続きへ渡し、手続きが照合の後に確かめる。
- `src/features/auth/errors.ts`: セッションの失敗の文言。認証エラーの文言は`./infrastructure/supabase-auth-failure`の`authErrorMessage`に委ねる。
- `src/lib/supabase/session.ts`: `proxy.ts`から呼ばれ、認証済みの`/signin`を、有効な遷移元があればそこへ、無ければ`/rounds`へ送る。認証の機能の入口の`readReturnTo`、`signInHref`を使う。

流れは次のとおりである。

1. 送信時に、メールアドレス、パスワード、captchaの順に検証する。
2. 通れば、`signInWithPassword`をトークン付きで呼ぶ。
3. 成功なら、送信時のURLの遷移元、無ければ`/rounds`へ遷移する。遷移元の読み出しか遷移が失敗したときも、失敗と同じく通信エラーを表示し、captchaのトークンを消費し、送信中を解除する。失敗なら、集約が文言を選んで表示し、captchaのトークンを消費し、手続きがウィジェットのやり直しを頼む。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| --- | --- | --- |
| サインインをServer Actionでなく、クライアントから直接呼ぶ | 送信中に別の画面へ移動すると、Server Actionのリダイレクトと競合したため、Server Actionをやめた。詳細: #318 | 競合を避けられる方式が出たとき |
| ネイティブの`disabled`と入力欄の検証を使わず、`noValidate`と`aria-disabled`で表す | 空入力やcaptcha未完了の理由を利用者へ伝えるため | 理由を別の方法で利用者へ伝えるとき |
| 成功時は送信中を解除しない | 遷移までの二重送信を防ぐため | 遷移方式を変えるとき |
| 接続を送信時に取得する(描画時に作らない) | 描画時に作ると、`/signin`の事前描画にSupabaseの環境変数が要り、欠落が通信エラーの表示でなく描画の失敗になるため。認証の実装が、渡された関数で照合のたびに取得する | 環境変数の欠落を描画時に検知したいとき |
| 二重送信の判定は、描画を待たない最新の状態で行う | 同じタスクで届く2回目の送信を、再描画の前に拒否するため。描画時点の状態では、2回目の照合が使用済みのトークンで行われる | 状態を画面の外で持つ方式にするとき |
| 認証サービスのクラス名とエラーコードは、インフラ層の変換だけが知り、ドメイン層は失敗の種類と文言を持つ | 認証サービスを差し替えても、ドメイン層と文言の表が変わらないため | 認証サービスを差し替えるとき |
| 機能の他の操作が同じ役目を持つ約束(遷移、画面の約束)は、手続きと別のファイルに置く | 他の操作が手続きどうしの依存なしで使えるため | 他の操作が同じ役目を持たないと分かったとき |
| アンマウント後は状態を更新しない | 送信中に画面を離れた場合の不整合を防ぐため。画面が`isMounted`を手続きへ渡し、手続きが照合の後に確かめる | 状態を画面の外で持つ方式にするとき |
| サインインのパスワードに、サインアップのパスワード規則を適用しない | 規則の変更前に作った既存アカウントでも、サインインできるようにするため | 既存アカウントが規則を満たすことを確認できたとき |
| Turnstileを使い、ローカル、CI、previewでは常に成功するテスト用キーを使う | ブルートフォースを抑えつつ、E2Eを外部に依存させないため | captchaの方式を変えるとき |
| Turnstileはinteraction-onlyで描画し、操作が必要なときだけ領域を出す | 通常の利用者にチェックの枠を見せないため。Invisibleは操作が必要な利用者を救えないため採らない。 | Cloudflareが表示方式を変えたとき |
| 遷移元を`/rounds`配下の許可リストで検証し、クエリ`returnTo`で渡す | 保護対象外の`/signin`へのループとオープンリダイレクトを同時に避け、保存を持たずURLだけで完結させるため | 保護対象の画面が`/rounds`の外にできたとき |
| 認証済みのリダイレクトを`proxy.ts`へ集約し、画面ごとのE2Eは残す | 実装を一箇所にまとめつつ、各画面の挙動を保証するため | ガードの実装を変えるとき |
| 規則を集約に、順序を手続きに分け、手続きを入口で生成して画面へ注入する。メールアドレスの規則と認証の失敗の文言と遷移元の規則は、認証の機能が1か所で持ち、サインアップとパスワード再設定が同じ機能の中から相対パスで使う。水和の完了を`data-hydrated`で示す | 規則と順序を画面から切り離し、規則の持ち主を1つにし、水和前の操作によるE2Eの不安定さを避けるため | E2Eが水和を別の方法で待てるとき |

## 制約と未対応

- 再試行の回数制限は、captcha以外に設けていない。
- signup・reset-passwordを経由すると遷移元は引き継がない。
- 認証の機能が他の機能へ公開する名前は、入口の`NETWORK_ERROR_MESSAGE`、`readReturnTo`、`signInHref`だけである。他の機能のファイルは、認証の機能の内部を参照せず、入口だけを参照する。同じ機能の中の未適用のファイル(`errors.ts`、`session-guard.ts`、`features/auth/reset-password/`のファイル)は、入口を経由せず、`domain/`のファイルを相対パスで参照する。
- `sign-out.ts`は、入口に出せない外部のエラーの変換`authErrorMessage`を、`infrastructure/supabase-auth-failure`から層までのパスで参照する(`docs/architecture.md`第16節)。
