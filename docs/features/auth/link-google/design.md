# auth/link-google 設計

## 概要

設定パネルの分類「アカウント」の「Google認証」の行で、Googleアカウントの結び付きを表示し、追加・削除する。別の画面とハッシュは持たない。
追加は認証サービスの手動の結合(`linkIdentity`。PKCE)で行う。結び付けは認証サービスがGoogleからの戻り(`/callback`)の時点で行う(実測)。画面は戻りの`code`を交換せず、今のセッションのまま結び付きを読み直して結果を示す。
削除は、DBの関数`ensure_email_identity()`でメールの手段(emailのidentity)を確かめてから、標準の`unlinkIdentity`で行う。Googleで作ったアカウントもGoogleを削除できる。
アカウントを残したままメールの手段だけを削除することは、DBのトリガーが拒否する。
行の表示は、端末の「アカウントの概要」の記録(`docs/features/auth/design.md`)から読み、オンラインで開いたときと操作の後に認証サービスから読み直す。

## 画面と状態

| 状態 | 表示・操作 | 次の状態 |
| --- | --- | --- |
| 結び付きなし | 「Google認証」と「追加」 | 「追加」でGoogleへの移動中。オフラインは案内を示して留まる |
| 結び付きあり | 「Google認証」、Googleアカウントのメールアドレス、「削除」 | 「削除」で削除の確認 |
| Googleへの移動中 | 「追加」が処理中。パネルは処理中(閉じる・分類・戻るを受け付けない) | Googleの画面へ移る。開始の失敗は理由を示して元へ。bfcacheで戻ると元へ |
| 戻りの処理中 | Googleから戻り、入口がパネルを分類「アカウント」で開いた。「追加」が処理中 | 下の「戻りの扱い」の結果を示す |
| 削除の確認 | 入れ子の確認ダイアログ(サインアウトと同じ`BlockingConfirmDialog`)。説明と「削除」「キャンセル」 | キャンセルで元へ。「削除」で削除中 |
| 削除中 | 「削除」が処理中。パネルは処理中 | 成功で「結び付きなし」と削除した旨。失敗は理由を示す |

戻りの扱い(`resume`):

| 戻り | 表示 | 結び付き |
| --- | --- | --- |
| `code`つき | 読み直して、今のアカウントに結び付いていれば「Googleアカウントを追加しました。」。結び付いていなければ成功と示さず、読み直した行だけを示す | 認証サービスが結び付け済み |
| `error=access_denied`(取り消し・拒否) | 失敗の種類`google_link_cancelled`。「Googleアカウントは追加されていません。」 | 変わらない |
| `error_code=identity_already_exists` | 失敗の種類`google_link_taken`。「このGoogleアカウントは別のアカウントで使われているため、追加できません。」 | 変わらない |
| その他の失敗 | 既存の失敗の種類`other`。「エラーが発生しました。しばらくしてから再度お試しください。」 | 変わらない |
| 戻った時点でサインインが切れている | 何も示さず、見張りがサインイン画面へ移す(app/settings) | - |

- 削除の確認の説明: 「Googleアカウントの結び付きを削除します。削除後は、メールアドレスの認証コードでサインインできます。後でこのGoogleアカウントで認証すると、メールアドレスがこのアカウントと同じときは再びこのアカウントに結び付き、異なるときは新しいアカウントが作られます。」
- 削除の成功: 「Googleアカウントの結び付きを削除しました。」
- 結果が分からない失敗(通信の断、応答なし)は成功と示さず、読み直した行と「通信エラーが発生しました。…」を示す。読み直せないときは記録の行のまま。
- オフラインで「追加」「削除」を押したときは「ネットワークに接続されていません。…」を示し、何も送らない。行は記録のまま表示する。
- 文言は`ui/auth-messages.ts`に置く。設定の行の名「Google認証」は`settings-messages.ts`。

## 構成とデータの流れ

以下の`src/`は`apps/web/src/`からの相対である。

| ファイル | 責務 |
| --- | --- |
| `src/features/auth/domain/link-google-flow.ts` | 集約。行に示す概要、実行中の操作(`pending`。`adding`・`removing`)と確認中の排他、開始の判定(実行中・読み込み中 → オフライン)、結果の知らせ(`added`・`removed`)と失敗の種類を状態に持つ |
| `src/features/auth/domain/google-return.ts` | 戻りのクエリ(`code`、`error`、`error_code`、追加の印)の読み取りと、外したクエリ |
| `src/features/auth/application/link-google.ts` | 手続き。`start`(押下)、`capture`(入口が戻りを預ける)、`resume`(行の部品のマウント時)、`remove`、`refresh`(読み直し)。約束`LinkGoogleAuthenticator`、`AccountSummaryStore`、`EmailIdentityPreparation`、`Connectivity`を受ける |
| `src/features/auth/infrastructure/supabase-auth.ts` | `startGoogleLink({ returnPath })`は`linkIdentity({ provider: 'google', options: { redirectTo } })`(SDKがGoogleへ移す)。`readAccount()`は`getUser()`から利用者ID・メールアドレス・最も古いGoogleの手段(ID・メールアドレス)を作る。`unlinkGoogle(identityId)`は`getUserIdentities()`から該当の手段を探して`unlinkIdentity`する |
| `src/features/auth/infrastructure/supabase-email-identity.ts` | `rpc('ensure_email_identity')`を呼ぶ |
| `src/features/auth/ui/link-google-row.tsx` | 行の値と操作(アドレス、「追加」「削除」、確認ダイアログ)。処理中(`pending`があるとき)を集約の状態から導き、設定の入口から受けた`onBusyChange`で知らせ、押した方のボタンだけを処理中に見せる。知らせと失敗の種類を文言の一覧の文言に写して示す(文言はUI層が持つ。`docs/features/auth/design.md`)。マウント時に`resume`と`refresh`(オンラインのとき)を呼ぶ |
| `src/features/auth/ui/link-google-context.tsx` | アプリで1つの手続き(入口が生成する)を、行と、戻りを預ける入口へ渡す文脈 |
| `src/app/(main)/layout.tsx`(入口) | 読み込み後に1回、クエリを`linkGoogle.capture(search)`に渡し、預けられたら戻りを外したクエリへ書き換え(`PageAddress.rewrite`)、設定パネルを分類「アカウント」で開く |
| `src/app/(main)/settings-panel-entry.tsx`(入口) | 「Google認証」の行の値と操作として`LinkGoogleRow`を設定パネルへ渡す |
| `src/routes.ts` | 追加の印のクエリ名`LINK_GOOGLE_PARAM` |
| `supabase/migrations/`の追加migration | `ensure_email_identity()`と、メールの手段の削除を拒否するトリガー`keep_email_identity` |

追加の流れ:

1. 押下: 開始の判定(実行中 → オフライン)。戻り先は`/rounds?<LINK_GOOGLE_PARAM>=1#settings/account`(成功の戻りではハッシュが保たれ、失敗の戻りでは認証サービスが`#error=…`に置き換える。実測)。印は戻りが追加のものだと見分けるためだけの固定の値である。`startGoogleLink`の失敗は理由を示す。
2. 戻り: 認証サービスは`/callback`で結び付け、`redirectTo`へ`code`(または`error`)を付けて戻す(実測)。入口が`capture`し、戻りを外して分類「アカウント」を開く。
3. 再開: 行の部品が`resume`。上の表のとおり。`code`は交換しない(結び付けは済んでおり、交換するとセッションがoauthの新しいものに置き換わるだけのため)。PKCEの検証子のcookieは残るが、次のOAuthの開始で置き換わる。
4. 成功の後、`readAccount()`で読み直し、記録を更新する。

削除の流れ:

1. 「削除」で確認ダイアログ。確認で開始の判定(実行中 → オフライン)。
2. `ensure_email_identity()`。失敗は理由を示して止まる(Googleは変わらない)。
3. `unlinkGoogle(identityId)`。成功で`readAccount()`し、記録を更新し、削除した旨を示す。拒否は理由を示す。結果不明は読み直した行を示す。2の後に3が失敗しても、メールの手段が増えるだけで害は無い。
4. この端末と他の端末のセッションは終えない(認証サービスの解除はセッションを終えない)。

DBの契約:

- `ensure_email_identity()`: SECURITY DEFINER、`search_path = ''`、引数なし、EXECUTEは`authenticated`だけ。対象は`auth.uid()`の利用者だけ。
  - 利用者のメールアドレスが空、未確認(`email_confirmed_at`がnull)、`is_sso_user`、削除済み(`deleted_at`)、「削除済みの利用者」なら`PT403`で何も変えない。
  - 既に`provider = 'email'`の手段があれば何もしない(冪等)。
  - 無ければ、認証サービスがメールアドレスの変更の完了時に作る形と同じ手段を1行作る: `provider = 'email'`、`provider_id`は利用者のID、`identity_data`は`sub`(利用者のID)・`email`(利用者のメールアドレス)・`email_verified: true`・`phone_verified: false`、`last_sign_in_at`・`created_at`・`updated_at`は今(実測で照合)。
  - 利用者の行をロックし、同時の呼び出しで2行作らない。
  - `app_metadata.providers`は書き換えない。認証サービスが解除の時に計算し直す(実測)。
- トリガー`keep_email_identity`(`auth.identities`の`BEFORE DELETE`、行ごと、`WHEN (old.provider = 'email')`、関数はSECURITY DEFINER・`search_path = ''`、EXECUTEは`PUBLIC`・`anon`・`authenticated`から外す):
  - 削除される手段の利用者が`auth.users`にまだあり、その利用者が確認済み(`email_confirmed_at`がnullでない)なら、例外で拒否する。
  - 直接の`unlinkIdentity`は、認証サービスの500(本文に例外のコードと文言)になる(偽のGoogleで実測)。
  - 利用者の削除の連鎖(アカウント削除)では、利用者の行が先に消えているため通る(ロールバックするトランザクションで実測)。
  - Googleの解除(`provider = 'google'`)は`WHEN`で対象外(実測)。メール変更の完了は、認証サービスが同じ行を`UPDATE`するため対象外(実測)。`ensure_email_identity()`は`INSERT`のため対象外。
  - 確認していない利用者を通すのは、次の場合に、認証サービスが未確認のメールの手段を消すため(実測)。
    - コードを要求しただけで確認していない利用者が、同じアドレスのGoogleで認証したとき(自動結合)。
    - このときGoogleでのサインインは成功し、手段はgoogleだけになる。
    - 未確認の利用者は記録を持たず、乗っ取りの連鎖の対象にならない。
  - 識別子の`identity_data`の`email_verified`は、確認済みの利用者でも偽のままの行が多いため、条件に使わない(ローカルのDBで確認)。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| --- | --- | --- |
| 追加の戻りの`code`を交換しない | 認証サービスは`/callback`で結び付けを終えており、交換はセッションをoauthの新しいものへ置き換えるだけのため。交換しないので、戻りの時に今のセッションは変わらない | 認証サービスが交換の時に結び付けるよう変わったとき |
| 追加の戻り先を`/rounds`のクエリの印にし、入口が分類「アカウント」を開き直す | 失敗の戻りでは認証サービスがハッシュを置き換え、`#settings/account`が残らないため(実測)。背景の画面のクエリの読み取りと干渉させないため、背景はホームに固定する | 認証サービスがハッシュを保つようになったとき |
| メールの手段は、Googleの削除の直前にDBの関数で作る(作成時に作らない) | 認証サービスのサインインの処理に割り込まず、失敗の影響がGoogleの削除だけに限られるため。作成時に作る案は、未確認の利用者への自動結合で取りこぼし、削除時の処理も要るため採らない | 認証サービスがGoogleでの作成時にメールの手段を作るようになったとき |
| 関数の作る手段は、認証サービスのメールアドレス変更の完了時と同じ形にする | 後のメールアドレス変更で、認証サービスがこの手段を同じ利用者IDの`provider_id`で探して更新するため(実測) | 認証サービスが手段の形を変えたとき |
| アカウントを残したままの確認済みのメールの手段の削除を、DBのトリガーで拒否する | 盗まれたセッションで攻撃者のGoogleを結び付け、メールの手段を外すと、アカウントのメールアドレスがGoogleのアドレスへ移り、メール変更の二重確認なしに乗っ取れるため。認証サービスには解除を手段の種類で止める設定が無い | 認証サービスがメールの手段の解除を止める設定を持ったとき |
| 直接の呼び出しで複数のGoogleが結び付いたときは、作成の最も古い1つを行に示し、「削除」はその1つを解除する | 画面からは1つまでとし(要件)、表示の規則を1つにするため | 複数のGoogleを画面で扱う要求が出たとき |

## 制約と未対応

- 手動の結合は認証サービスのbetaで、SLAの対象外である。
- 「追加」の前の本人確認は無い。盗まれたサインインで追加されたときは、知らせるメールで気付く(`docs/security.md`)。
- 戻りの背景の画面はホームになる。
- 追加・削除の知らせるメールは、認証サービスの標準の通知(`identity_linked`、`identity_unlinked`)を有効にするだけで、AIMSは送らない。
