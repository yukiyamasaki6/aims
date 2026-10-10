# offline-pwa 設計

## 概要

アプリをPWAとしてインストールでき、Service Workerが `/rounds`、`/rounds/new`、`/rounds/<任意のID>` の枠をプリキャッシュから返す（キャッシュ優先）。
オフラインでも枠が開き、内容は枠内で取得し、`navigator.onLine` が false のときは「ネットワークに接続されていません」、通信の失敗は「読み込めませんでした。」を示す。
枠のないパスのオフライン時だけ、静的な `/offline` を返す。
ページ内容、RSC、APIはキャッシュしない。

## 画面と状態

| 画面・状態 | 内容 | 要求 |
| :--- | :--- | :--- |
| Service Worker | 初回アクセスで登録され、枠と静的アセットを同時にプリキャッシュする。 | offline-pwa-01 |
| インストール | Manifestを満たすとき、ブラウザがアプリとして認識する。 | offline-pwa-02 |
| Service Workerの更新 | 新しいビルドが現れると、待機せずに有効になる。 | offline-pwa-03 |
| `/offline` | 認証に依存しない静的なページ。枠のないパスで、通信に失敗したときだけ返す。 | offline-pwa-04 |
| 起動 | `start_url` は `/rounds`。アプリの起動はmanifestの`start_url`を開くことと同じとして扱い、認証済みはラウンド一覧、未認証は `proxy.ts` が `/signin` へ移す。 | offline-pwa-05, 06 |
| ラウンドの枠（`/rounds`、`/rounds/new`、`/rounds/<ID>`） | オンライン・オフラインともService Workerが枠を返す。内容は枠内の取得結果で決まり、オフラインの枠はオンライン復帰で自動再取得する。保存済みの参照データ（的・プリセット）があるときは、取得できなくてもそれを表示する(`rounds/start`)。作成が未確定のラウンド詳細は、ラウンドを取得せず端末の操作の列から表示し、的の一覧の保存分があればオフラインでも内容を表示する。端末がオフラインで開けるベースを持つラウンド(入力中、またはベースに反映されていない操作(未送信、または確定済みで取得に未反映)が残るもの)の詳細も、端末のベースと操作の列から表示する(的の一覧の保存分があるとき。`rounds/detail`)。ベースか的の一覧の保存分を持たないラウンドは、枠と「ネットワークに接続されていません」を表示する。一覧は、端末が知る入力中のラウンドを先頭の領域に出し、その下に「ネットワークに接続されていません」を出す(`rounds/history`)。 | offline-pwa-07, 08, 09, 10, 11, 14, 15, 16、detail-27, 28 |
| 未認証・期限切れ | 枠から `SessionGuard` が `/signin` へ移す。 | offline-pwa-12, 13 |

## 構成とデータの流れ

- `src/app/layout.tsx` の `SerwistProvider` が `/sw.js` を登録する。本番ビルド以外では無効にする。
- `src/app/sw.ts` がService Workerの本体である。
  - 新しいService Workerを待機させず即座に有効にする。
  - 枠のナビゲーションをプリキャッシュから返す（`PrecachedFrame`）。枠が未格納なら通常のネットワーク取得に落とす。
  - フォント、画像、`/_next/static` のJS、CSSをキャッシュする。
  - 同一オリジンのその他のリクエスト（RSCを含む）はNetworkOnlyにする。クロスオリジンは経由させない。
  - 枠のないパスのナビゲーションの失敗時は `/offline` を返す。`navigationPreload` は使わない。
  - `/__shell/` 配下のプリキャッシュ応答がリダイレクトされたら、インストールを失敗させる。
- `src/app/sw-frames.ts` が枠の定義（パスに対応する枠のURL、プリキャッシュ対象）を持ち、`sw.ts` と `serwist.config.mjs` が共有する。
- `serwist.config.mjs` が `public/sw.js` を生成し、`/offline` と枠3件（`/__shell/rounds`、`/__shell/rounds/new`、`/__shell/rounds/_`）をHTMLの内容ハッシュのリビジョンでプリキャッシュする。リビジョンはビルドごとに変わる。
- `next.config.ts` が `/__shell/*` を実ルートへrewriteし（`beforeFiles`）、`/rounds/<ID>` を `/rounds/_` へrewriteする（`afterFiles`）。`/__shell/*` は `proxy.ts` の対象外なので、未認証の登録でも各画面の枠が保存される。オンラインの `/rounds/<ID>` も `/rounds/_` の枠だけが配信され、IDごとの生成物は作られない（`rounds/[id]/page.tsx` の `dynamicParams = false`）。
- `src/app/sw-update-activator.tsx` の `SwUpdateActivator`（`layout.tsx` に配置）が、新しいService Workerが `waiting` のまま残っていれば `SKIP_WAITING` を送り、`sw.ts` が受けて `skipWaiting()` を呼ぶ。表示は行わない。
- `src/app/manifest.ts` がManifestを返す。`start_url` は `/rounds` で、未認証の起動は `proxy.ts` が `/signin` へ移す。
- `src/features/fetch-result/fetch-result.ts` が取得結果（ok / not-found / offline / error）と、レスポンスから結果を決める `classifyResponse` を持つ。通信失敗（`status: 0`）は原因を断定せず固定文の `error`、`PGRST116` は `not-found`、その他のエラーも固定文の `error` にする。`offline` は `fetchContent` が `navigator.onLine` の false と `offline` イベントで確定したときだけ返す。
- `fetch-content.ts` の `fetchContent` が取得の入口である。`navigator.onLine` が false なら `readSession` もクエリも呼ばず `offline` を返す。それ以外は `readSession`（`features/auth/session-state.ts`）を `offline` イベントと競わせ、認証済みのときだけ、確かめたセッションでクエリを実行する。クエリが認証の拒否（401か`PGRST301`）で返ったら、更新を強制してセッションを確かめ、認証済みなら1回だけ取り直す。クエリには `.retry(false)` を付ける。全体は10秒の時間制限（`FETCH_TIMEOUT_MS`）とも競わせ、超えたら `error` にする。代わり（保存済み）がある取得は1秒（`FALLBACK_WAIT_MS`）で時間切れにし、その後も10秒までは結果を待って`onLateResult`へ渡す（表示しない）。`readSession` の例外・通信失敗も `error` にする。
- `fetch-state.tsx` が取得中・見つからない・オフライン・エラーの枠内表示（取得中以外は枠の領域の中央。取得中の骨組みは画面ごとに渡し、読み込み後の形に揃える）を担い、`use-fetch-result.ts` が取得中の状態、アンマウント後の結果の破棄、取得関数の例外のerror化、再試行、offline表示の間だけ`online`イベントを購読する自動再取得を持つ(`offline`に決まった時点ですでにオンラインなら、購読せずすぐ再取得する)。depsが変わった描画では前の結果を見せずloadingにする。
- `/rounds/_` は `/rounds/[id]` の静的な枠で、任意のIDの水和に使える。Service Workerは任意のIDのナビゲーションに、キャッシュキーを変えてこの枠を返す。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| データを含まない枠だけをプリキャッシュし、枠のナビゲーションはキャッシュ優先、ページ内容、RSC、APIはキャッシュせずNetworkOnlyにする | 認証依存のレスポンスをキャッシュすると、サインアウト後に前のユーザーのデータが残り、認証ガードも迂回されうるため。枠は通信が不安定でも待たずに起動でき、オフラインで開く。`proxy.ts` が走らないため、未認証の遷移は枠の `SessionGuard` が担う。参照データ（的・プリセット）だけは、取得関数がユーザーごとのキーで`localStorage`に保存する（`rounds/start`）。SWはキャッシュしない。 | 読み取りキャッシュを導入するとき。認証ガードをサーバーに戻す必要が生じたとき。 |
| 枠を `proxy.ts` の対象外の `/__shell/*` で配り、資産と同一のプリキャッシュで更新する（全か無か） | プリキャッシュの取得も `proxy.ts` を通り、未認証の登録で `/signin` のHTMLが枠として保存されるため。リダイレクトされた応答は保存せずインストールを失敗させる。内容ハッシュのリビジョンで新旧が混在せず、`skipWaiting` と `clientsClaim` で即座に切り替える。 | `proxy.ts` の対象を変えるとき。更新プロンプトを導入するとき（#478）。 |
| 任意のIDは、Service Workerがキャッシュキーを変えて `/rounds/_` の枠を返し、サーバーも `next.config.ts` のrewriteで同じ枠へ向ける | URLを変えずに枠を共有でき、`dynamicParams` が既定のままではIDごとのHTMLが永続化され続けるため（`dynamicParams = false` で固定する）。`proxy.ts` でのrewriteはCookieの複写が要るため採らない。 | 枠をIDごとに分ける必要が生じたとき。 |
| クロスオリジンのリクエストをService Workerへ通さない | 全体に一致するcatch-allがTurnstileの検証通信を拾い、検証が完了しなくなったため、全体を拾う設定をやめた。 | 通すべき外部リソースが生じたとき。 |
| 更新時に `waiting` のまま残った新Service Workerを、ページから `SKIP_WAITING` で有効化し直す（最大3回、1秒間隔） | 新SWの `install` 完了時にChromiumが旧SWを停止して有効化へ進むが、その約10〜20msの間に制御下のページのfetchが旧SWを再起動させると、有効化が再試行されず、旧SWが再び有効のまま新SWが `waiting` に残る。`skipWaiting` は既に呼ばれているため、`SKIP_WAITING` の再要求が要る。放置すると旧SWのアイドル停止（約30秒）まで更新が遅れる。 | 更新プロンプトを導入するとき（#478）。 |
| オンライン復帰時、ページをリロードせず(`reloadOnOnline` を無効にする)、offline表示の間だけ `online` イベントで枠内を自動再取得する。契機は `online` イベントだけにする。取得の途中で届いて受け取れなかった `online` は、`offline` に決まった時点で `navigator.onLine` が true ならすぐ再取得して補う | 内容は枠内で再取得するためページのリロードが要らず、展開中の入力を失わせるため。送信は `online` イベントで再送される。`offline` に決まる前の `online` は購読しても次が来ず、オンラインのまま表示が止まるため。errorは `online` で原因が解消せず、繰り返すと失敗の連打になる。`navigator.onLine` が true で通信できないときに状態から再試行すると、10秒ごとの再取得になる。端末のベースで表示している間は、`navigator.onLine`が`true`のまま通信が戻る場合のため、既存の`retryDelayMs`の間隔でも取り直す(`rounds/detail`)。 | ページをキャッシュするとき。通信の復帰を `online` 以外で検知できるとき。errorの自動再試行が要るとき。 |
| `pnpm preview` で `serwist build` を実行する | プレビューとE2Eで古い、または存在しないService Workerが使われたため。 | Service Workerの生成手順を変えるとき。 |
| 未認証を取得結果に含めず、取得前に `readSession` で確かめ、未認証ではクエリを実行しない。未認証は、保存先にセッションが無いときと、サーバーが更新を拒否したと確定したときに限る。auth-jsの更新の破棄と、別の書き手と重なった拒否は、保存先を読み直して判定する | 遷移を取得関数と `SessionGuard` の両方が行うと二重になるため、取得関数は遷移せず `error`（「サインインが必要です。」）を返す。セッションなしのクエリは匿名キーで送られ、RLSで0件になり、`not-found` と誤判定されるため、実行しない。更新の通信中に `proxy.ts` のSet-Cookieや別のタブが保存先を書き換えると、auth-jsは保存先に有効なセッションを残したままセッションなしを返すため。 | 取得関数が遷移を担う設計にするとき。クエリが認証なしの結果を区別して返すようになるとき。auth-jsが書き換えの重なりを自ら解決するようになったとき。 |
| `navigator.onLine` が false のときと `offline` イベントだけを `offline` とし、通信の失敗と取得全体の10秒の時間切れは原因を断定せず `error`（「読み込めませんでした。」、再試行可能）にする。回線が接続中でも外に出られない場合は自動復帰せず、再試行で復帰する | CDPのオフライン化とPlaywrightのsetOfflineのエミュレーションでは、オフラインのまま開いた文書の `navigator.onLine` が true のままで、`online` も `offline` も `navigator.connection` の `change` も届かないため、通信の失敗を「接続されていません」と断定できない。時間制限は、`navigator.onLine` が true のまま通信できないとき、期限切れのトークンの更新の再試行で約30秒、通信が応答しないと数分、枠が取得中のまま固定されるため。上限に達したときの代わりがある待ち（保存済みがある読み取り、開始時の認証確認）は1秒、代わりが無い待ちは10秒にそろえる。 | 通信の復帰を `online` 以外で確実に検知できるとき。取得が10秒を超えるのが通常の回線が生じたとき。 |

## 制約と未対応

- `serwist.config.mjs` が `sw-frames.ts` をNodeの型除去で読むため、Node 22.18以上が前提（`.node-version` は24）で、ビルド時に `MODULE_TYPELESS_PACKAGE_JSON` の警告が出る。
- Service Workerが未登録、または制御していないタブのオフラインは、ブラウザ標準のエラーになる。iOS Safariのホーム画面アプリでの挙動は実機で確認していない。
- 更新時の旧SWの停止とページのfetchが重なると、新SWが `waiting` のまま残ることがある（実ブラウザのChromiumで再現。数ms間隔でfetchを続けるページでのみ。10ms以上の間隔では再現しない）。この間も旧SWが枠とオフライン動作を提供し、ページ遷移は止まらない。`SwUpdateActivator` が通常は約100msで有効化し直す。この機構が入る前のビルドから更新する場合は、旧SWのアイドル停止（約30秒）まで有効化が遅れうる。
- Service Workerの更新直後、開いたままの旧ドキュメントの遅延チャンクは取得できない。通常の遷移はハードナビゲーションで回復する。
- 利用者の記録のオフライン表示は、詳細(保持するラウンド)と一覧(入力中のラウンド)を扱う。参照データは`rounds/start`が扱う。
- `navigator.onLine` が true のまま通信できないときは、取得の時間制限（10秒）まで枠は取得中のままで、その後に「読み込めませんでした。」と再試行ボタンを出す（保存済みがあれば1秒で保存済みを出す）。`online` イベントが来ないため自動再取得はせず、再試行ボタンで復帰する（端末のベースで表示するラウンド詳細は、間隔を置いて自動で取り直す）。時間切れ後に遅れて届いた結果は捨てる。
