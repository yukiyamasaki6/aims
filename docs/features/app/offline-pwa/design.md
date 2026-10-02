# offline-pwa 設計

## 概要

アプリをPWAとしてインストールできるようにし、通信がない状態でページを開いたときは静的な `/offline` ページを表示する。
Service Workerが持つのは、ビルド成果物の静的アセットのキャッシュと、オフライン時のナビゲーションの受け止めだけである。
認証状態に依存するページやデータはキャッシュしない。

## 画面と状態

| 画面・状態 | 内容 | 要求 |
| :--- | :--- | :--- |
| Service Worker | 初回アクセスで登録される。 | offline-pwa-01 |
| インストール | Manifestを満たすとき、ブラウザがアプリとして認識する。 | offline-pwa-02 |
| Service Workerの更新 | 新しいビルドが現れると、待機せずに有効になる。 | offline-pwa-03 |
| `/offline` | 認証に依存しない静的なページ。オフラインのナビゲーション失敗時に返す。 | offline-pwa-04 |
| 起動 | `start_url` は `/rounds`。アプリの起動はmanifestの`start_url`を開くことと同じとして扱い、認証済みはラウンド一覧、未認証は `proxy.ts` が `/signin` へ移す。 | offline-pwa-05, 06 |

## 構成とデータの流れ

- `src/app/layout.tsx` の `SerwistProvider` が `/sw.js` を登録する。本番ビルド以外では無効にする。
- `src/app/sw.ts` がService Workerの本体である。
  - 新しいService Workerを待機させず即座に有効にする。
  - フォント、画像、`/_next/static` のJS、CSSをキャッシュする。
  - 同一オリジンのその他のリクエストはNetworkOnlyにする。クロスオリジンは経由させない。
  - ナビゲーションの失敗時は `/offline` を返す。
- `serwist.config.mjs` が `public/sw.js` を生成し、`/offline` を個別にプリキャッシュする。リビジョンは `offline.html` のハッシュで、ビルドごとに変わる。
- `src/app/manifest.ts` がManifestを返す。`start_url` は `/rounds` で、未認証の起動は `proxy.ts` が `/signin` へ移す。
- `src/features/fetch-result/fetch-result.ts` が取得結果（ok / not-found / offline / error）と、レスポンスから結果を決める `classifyResponse` を持つ。通信失敗（`status: 0`）は `offline`、`PGRST116` は `not-found`、その他のエラーは固定文の `error` にする。
- `fetch-content.ts` の `fetchContent` が取得の入口である。オフラインなら `getSession()` もクエリも呼ばず `offline` を返す。それ以外は `getSession()` を `offline` イベントと競わせ、authenticated のときだけクエリを実行する。クエリには `.retry(false)` を付ける。
- `fetch-state.tsx` が取得中・見つからない・未接続・エラーの枠内表示を担い、`use-fetch-result.ts` が取得中の状態、アンマウント後の結果の破棄、取得関数の例外のerror化、再試行を持つ。depsが変わった描画では前の結果を見せずloadingにする。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| ページ、RSC、APIをキャッシュせずNetworkOnlyにする | 認証依存のレスポンスをキャッシュすると、サインアウト後に前のユーザーのデータが残り、認証ガードも迂回されうるため。 | シェルとデータを分ける設計が入るとき（#479）。 |
| `start_url` を `/rounds` にする | 起動直後に記録を始められるようにするため。未認証の起動は入口のガードが `/signin` へ移す。 | 起動直後に別の画面を見せるとき。 |
| ナビゲーション失敗時の受け皿を、認証に依存しない静的な `/offline` にする | 認証状態によらず返せる唯一のページであるため。 | ページのキャッシュによるオフライン表示を導入するとき。 |
| クロスオリジンのリクエストをService Workerへ通さない | 全体に一致するcatch-allがTurnstileの検証通信を拾い、検証が完了しなくなったため、全体を拾う設定をやめた。 | 通すべき外部リソースが生じたとき。 |
| `reloadOnOnline` を無効にする | ページをキャッシュしないため不要で、送信は `online` イベントで再送されるため。 | ページをキャッシュするとき。 |
| `pnpm preview` で `serwist build` を実行する | プレビューとE2Eで古い、または存在しないService Workerが使われたため。 | Service Workerの生成手順を変えるとき。 |
| 未認証を取得結果に含めず、取得前に `getSession()` で確かめ、unauthenticated ではクエリを実行しない | 遷移を取得関数と `SessionGuard` の両方が行うと二重になるため、取得関数は遷移せず `error`（「サインインが必要です。」）を返す。セッションなしのクエリは匿名キーで送られ、RLSで0件になり、`not-found` と誤判定されるため、実行しない。 | 取得関数が遷移を担う設計にするとき。クエリが認証なしの結果を区別して返すようになるとき。 |
| `getSession()` にタイムアウトを設けず、`navigator.onLine` と `offline` イベントでオフラインを確定する | 待ち時間を設けずにオフラインを確定でき、通信できるのに遅いだけの場合を誤ってオフラインと判定しないため。 | `navigator.onLine` が true のままの停止を短くする要求が生じたとき。 |

## 制約と未対応

- オフラインで表示できるのは `/offline` のみで、ラウンドの画面は開けない。ページのキャッシュは #479 で扱う。
- オフラインの起動は `/offline` になる（#646で枠を返す）。
- `navigator.onLine` が true のまま通信できず、アクセストークンが期限切れのとき、`getSession()` の更新の再試行で最大約20秒止まる。`fetchWithAuth` が全クエリの先頭で `getSession()` を待つため避けられない。この間、枠は取得中のままで、`AuthRetryableFetchError` を受けた後に未接続と再試行ボタンを出す。
- オンライン復帰時の自動再取得は #647 で扱う。未接続の枠は再試行ボタンだけで復帰する。
