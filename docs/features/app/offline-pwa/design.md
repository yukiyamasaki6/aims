# offline-pwa 設計

## 概要

アプリをPWAとしてインストールでき、Service Workerが `/rounds`(ホーム)、`/rounds/history`、`/rounds/new`、`/rounds/<任意のID>`、`/settings`、`/settings/password` の枠をプリキャッシュから返す（キャッシュ優先）。
オフラインでも枠が開き、内容は枠内で取得し、`navigator.onLine` が false のときは「ネットワークに接続されていません」、通信の失敗は「読み込めませんでした。」を示す。
枠のないパスのオフライン時だけ、静的な `/offline` を返す。
ページ内容、RSC、APIはキャッシュしない。

## 画面と状態

| 画面・状態 | 内容 |
| :--- | :--- |
| Service Worker | 初回アクセスで登録され、枠と静的アセットを同時にプリキャッシュする。 |
| インストール | Manifestを満たすとき、ブラウザがアプリとして認識する。 |
| Service Workerの更新 | 新しいビルドのService Workerは待機し、表示中の画面は旧ビルドのまま動く。内部リンクの操作の前に待機中の版があれば、有効にしてから遷移させ、遷移先を最初から新しいビルドの枠で表示する。待機の判定は遷移ごとに同期に行い、判定できないとき、切り替えが進まないとき、リンク以外の経路(`router.push`、戻る・進む)では切り替えず、旧ビルドの枠で遷移する。待機が無い遷移では、更新を確認する。 |
| `/offline` | 認証に依存しない静的なページ。枠のないパスで、通信に失敗したときだけ返す。 |
| 起動 | `start_url` は `/rounds`(ホーム)。アプリの起動はmanifestの`start_url`を開くことと同じとして扱い、認証済みはホーム、未認証は `proxy.ts` が `/signin` へ移す。 |
| 設定の枠（`/settings`） | ラウンドの枠と同じく、Service Workerが枠を返す。内容は枠内で描き、通信を要しない(`app/settings`)。 |
| パスワード変更の枠（`/settings/password`） | 設定の枠と同じく、Service Workerが枠を返す。画面は開けるが、送信は通信を要し、オフラインでは送らずに拒否する(`auth/change-password`)。 |
| ラウンドの枠（`/rounds`、`/rounds/history`、`/rounds/new`、`/rounds/<ID>`） | オンライン・オフラインともService Workerが枠を返す。内容は枠内の取得結果で決まり、オフラインの枠はオンライン復帰で自動再取得する。保存済みの参照データ（的・プリセット）があるときは、プリセットは取得を待たずに先に表示し、取得できなくてもそれを表示し続ける(`rounds/start`)。作成が未確定のラウンド詳細は、ラウンドを取得せず端末の操作の列から表示し、的の一覧の保存分があればオフラインでも内容を表示する。端末がオフラインで開けるベースを持つラウンド(入力中、またはベースに反映されていない操作(未送信、または確定済みで取得に未反映)が残るもの)の詳細も、端末のベースと操作の列から表示する(的の一覧の保存分があるとき。`rounds/detail`)。ベースか的の一覧の保存分を持たないラウンドは、枠と「ネットワークに接続されていません」を表示する。ホームは取得せず、端末が知る入力中のラウンドを出し、オフライン表示は出さない。履歴は、履歴の中に「ネットワークに接続されていません」を出し、ラウンドは出さない(`rounds/history`)。 |
| 未認証・期限切れ | 枠のレイアウトが始める喪失の見張りが `/signin` へ移す。 |

## 構成とデータの流れ

- `src/app/layout.tsx` の `SerwistProvider` が、経路表(`src/routes.ts`)の `SW_PATH`(`/sw.js`)を登録する。本番ビルド以外では無効にする。
- `src/app/sw.ts`(Service Workerの入口)は、`Serwist` の構成の組み立てだけを行う。戦略は機能 `src/features/offline-pwa/` のインフラ層が持つ。
  - 新しいService Workerを待機させ、ページからの`SKIP_WAITING`(Serwistが既定で待ち受ける)で有効にする。初回の登録は`clientsClaim`で最初の画面を制御する。
  - `infrastructure/runtime-caching.ts`(`createRuntimeCaching`)が、枠のナビゲーション(`infrastructure/precached-frame.ts`の`PrecachedFrame`。プリキャッシュから返し、未格納なら通常のネットワーク取得に落とす)、枠のないナビゲーションのNetworkOnlyを定める。ナビゲーション以外の同一オリジンのリクエスト(RSCを含む)とクロスオリジンは、どの規則にも当てず、Service Workerが応答しない。
  - 枠のないパスのナビゲーションの失敗時は `/offline` を返す。`navigationPreload` は使わない。
  - `infrastructure/precache-guard.ts`(`precacheGuard`)が、プリキャッシュ応答が `ok` でないとき、インストールを失敗させる。
- `src/app/offline/page.tsx`(入口)は、`ui/offline-screen.tsx`の`OfflineScreen`(ロゴ、枠、文言)を描くだけである。文言は`ui/offline-pwa-messages.ts`の一覧(名前空間`offlinePwa`)から`useTranslations`で得る。要求の設定は`headers()`と`cookies()`を読まないため、ページは静的なままで、文言は最初のHTMLに含まれ、プリキャッシュされた枠はオフラインでも文言を表示する。
- 経路の持ち主は、経路表(`src/routes.ts`)と各機能の経路のファイルである。`/offline`、枠の配布URL(`OFFLINE_PATH`、`shellUrlOf`、`frameHtmlOf`)、枠の経路の一覧(`FRAME_PATHS`。ラウンドの4画面と、`SETTINGS_PATH`、`CHANGE_PASSWORD_PATH`)と、詳細のプレースホルダー(`ROUND_FRAME_ID`)は経路表が持つ。判定・変換の関数は、`roundFramePathOf` を `src/features/rounds/domain/round-routes.ts` が持ち、`sw.ts`(入口)がこれと`SETTINGS_PATH`、`CHANGE_PASSWORD_PATH`との一致から枠の配布URLを導く。`sw.ts`、`serwist.config.mjs`、`next.config.ts`、`manifest.ts` はここから導く。`proxy.ts` の `matcher` だけは、Next.jsが静的に読むため文字列で再掲し、`proxy.test.ts` が一致を確かめる。
- `serwist.config.mjs` が `public/sw.js`(経路表の `SW_PATH` から導く)を生成し、woff2を含む静的アセットと `/offline` と枠6件（`/__shell/rounds`、`/__shell/rounds/history`、`/__shell/rounds/new`、`/__shell/rounds/_`、`/__shell/settings`、`/__shell/settings/password`）をHTMLの内容ハッシュのリビジョンでプリキャッシュする。リビジョンはビルドごとに変わる。
- `next.config.ts` が `/__shell/*` を実ルートへrewriteし（`beforeFiles`）、`/rounds/<ID>` を `/rounds/_` へrewriteする（`afterFiles`）。`/__shell/*` は `proxy.ts` の対象外なので、未認証の登録でも各画面の枠が保存される。オンラインの `/rounds/<ID>` も `/rounds/_` の枠だけが配信され、IDごとの生成物は作られない（`rounds/[id]/page.tsx` の `dynamicParams = false`）。
- 更新の切り替えは、機能 `offline-pwa` の手続き `application/update-activation.ts`(`createUpdateActivation`)が担う。経路の変化で登録を保持し、待機中の版があるときの内部リンクの遷移を止め、`SKIP_WAITING`を1回送り、`controllerchange`の後、文書を読み直す直前に端末の保存の完了(記録のハブの`whenPersisted`)を再確認して遷移する。これらの待ちは、クリックからの合計で上限1秒(`SHORT_WAIT_MS`)を時計(`Clock`)で共有する。切り替えをしない経路は`whenPersisted`を呼ばない。待機の判定は保持した登録の`waiting`の同期の読み取りだけで行い、登録の保持の前の操作は止めない。経路の変化では、待機の有無によらず`registration.update()`を呼ぶ。読み込み時には切り替えない。
  - 約束(`SwHost`、`SwRegistration`、`LinkClicks`、`LinkClick`、`PersistenceWait`)を実装する外部への実装は、インフラ層 `browser-service-worker.ts`(`navigator.serviceWorker`)と `browser-link-clicks.ts`(`document`のcapture段階の`click`。修飾キーと同じ画面へのリンクのみを除く)である。
  - `ui/sw-update-activator.tsx`の`SwUpdateActivator`が、経路(`usePathname()`)の変化を手続きへ知らせる(表示は行わない)。
  - 入口 `root-client-entry.tsx` の `composeOffline` が手続きを生成し、効果で `start()` を呼び、`SwUpdateActivator` を描く。
- `<link rel="manifest">` は `src/app/manifest.ts` から Next.js が出す(`/manifest.webmanifest`)。`serwist.config.mjs` が読む `/offline` のHTMLの名前は、経路表の `frameHtmlOf(OFFLINE_PATH)` から導く。
- `src/app/manifest.ts` がManifestを返す。`start_url` は経路表の `ROUNDS_HOME_PATH`(`/rounds`)で、未認証の起動は `proxy.ts` が `/signin` へ移す。
- `src/app/apple-icon.png` はiOSホーム画面用アイコン(180x180、白の不透明な地)で、Next.jsのファイル規約により全ページに `apple-touch-icon` のlinkが出る。`scripts/generate-icon.mjs` が他のアイコンと一緒に生成する。`/apple-icon.png` は `proxy.ts` の対象外なので未認証でも取得できる。
- manifestのアイコン(any/maskable)は、環の直径を画像の幅の61%(`INSTALL_ART_SCALE`=61/80)にして生成する。絵柄全体を元の比率のまま縮める。表示は2経路ある。余白のある経路(インストールしたホーム画面、アプリの一覧)では、Chromeがmaskableに約1.309倍の透明の余白を足すため、画像の中央87.3%が表示され、環は枠の約70%に見える。余白のない経路(「ホーム画面に追加」の丸、ショートカット)では、画像の中央66.7%から70%が丸に表示され、環は枠の約87%から91%に見える。この経路で棒の先が欠けることは認めるが、環の外に棒は見える。iOS用のapple-iconは縮小しない(iOSは画像の全体を表示するため、環は枠の80%に見える)。環の外縁が半幅の80%という割合はicon.svg(タブ用)とapple-iconの値である。
- `src/features/rounds/domain/fetch-status.ts` が取得結果（ok / not-found / offline / error）と固定文言、問い合わせの結果の種類（`QueryOutcome`。`domain/query-outcome.ts`）から結果を決める `fetchResultOf` を持つ。応答を種類へ写す `failureOfResponses` は `src/features/rounds/infrastructure/db-response-outcome.ts` にあり、`status: 0` は通信失敗、401か`PGRST301`は認証の拒否、`PGRST116` は `not-found`、その他のエラーは失敗の種類にする。通信失敗は、`navigator.onLine` が false になっていれば `offline`、そうでなければ原因を断定せず固定文の `error` にする（`commFailure`）。認証の拒否とその他の失敗は固定文の `error` にする。`offline` は `fetchContent` が `navigator.onLine` の false と `offline` イベントで確定したときに返す。
- `features/rounds/application/content-fetcher.ts` の `createContentFetcher` が返す `fetchContent` が取得の入口である。サインインの状態の読み取り(認証の入口の`SessionReader`)、通信の可否(`Connectivity`)、時刻(`Clock`)は、入口が生成して引数で渡す。`navigator.onLine` が false なら `readSession` もクエリも呼ばず `offline` を返す。それ以外は `SessionReader`の`readSession`（認証の入口が公開する型を、型だけで受け取る。実装は入口が渡す。確かめたセッションは利用者のID（`{userId}`）を持つ）を `offline` イベントと競わせ、認証済みのときだけ、確かめたセッションでクエリを実行する。クエリが認証の拒否（401か`PGRST301`）で返ったら、更新を強制してセッションを確かめ、認証済みなら1回だけ取り直す。クエリには `.retry(false)` を付ける。全体は10秒の時間制限（`FETCH_TIMEOUT_MS`。`domain/fetch-wait.ts`）とも競わせ、超えたら、その時点で接続が切れていれば `offline`、そうでなければ `error` にする（`commFailure`）。時間切れ後に遅れて届いた結果は捨てる。`readSession` の例外・通信失敗、クエリの例外も、同じ`commFailure`で結果にする。`RoundsListStore`の`loadList`が、端末の保存の待ちを含む一覧の読み込みの全体を、開始から10秒で同じ`error`にする。詳細は、窓口(`RoundWindow`)が記録の読み込みの待ちだけを10秒で打ち切り(切断ならoffline、そうでなければerror。その後に完了すれば準備完了へ進む)、各取得(ラウンド、的)は`fetchContent`の10秒で打ち切る。両者は別のものを守り、同じ待ちを2重に囲まない。
- `features/rounds/ui/fetch-state.tsx` が取得中・見つからない・オフライン・エラーの枠内表示（取得中以外は枠の領域の中央。取得中の骨組みは画面ごとに渡し、読み込み後の形に揃える）を担い、`features/rounds/ui/use-fetch-result.ts` が取得中の状態、取得関数の例外のerror化、再試行、offline表示の間だけ通信の復帰(手続きの入れ物の`whenOnline`を引数で受ける。詳細の窓口は同じ自動再取得を窓口の内側で行う)を受ける自動再取得を持つ(`offline`に決まった時点ですでにオンラインなら、`whenOnline`が直ちに呼ぶ)。再試行の描画では前の結果を見せずloadingにする。
- `/rounds/_` は `/rounds/[id]` の静的な枠で、任意のIDの水和に使える。Service Workerは任意のIDのナビゲーションに、キャッシュキーを変えてこの枠を返す。

- 各ファイルの層は`docs/architecture.md`の「1. 構造」に従う。画面のパッケージは `react`、`next/navigation`(`usePathname`)、その他のパッケージは `serwist`(インフラ層、`sw.ts`)、`@serwist/next`(`app/layout.tsx` の `SerwistProvider`、`serwist.config.mjs`)である。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| データを含まない枠だけをプリキャッシュし、枠のナビゲーションはキャッシュ優先、ページ内容、RSC、APIはキャッシュしない(ナビゲーションはNetworkOnly、それ以外はService Workerが応答しない) | 認証依存のレスポンスをキャッシュすると、サインアウト後に前のユーザーのデータが残り、認証ガードも迂回されうるため。枠は通信が不安定でも待たずに起動でき、オフラインで開く。`proxy.ts` が走らないため、未認証の遷移は枠のレイアウトが始める喪失の見張りが担う。参照データ（的・プリセット）だけは、取得関数がユーザーごとのキーで`localStorage`に保存する（`rounds/start`）。SWはキャッシュしない。 | 読み取りキャッシュを導入するとき。認証ガードをサーバーに戻す必要が生じたとき。 |
| 枠を `proxy.ts` の対象外の `/__shell/*` で配り、資産と同一のプリキャッシュで更新する（全か無か） | プリキャッシュの取得も `proxy.ts` を通り、未認証の登録で `/signin` のHTMLが枠として保存されるため。内容ハッシュのリビジョンで新旧が混在せず、新しいビルドは待機させ、画面の遷移の瞬間に切り替える。 | `proxy.ts` の対象を変えるとき(`/__shell/*`を対象に含めると、未認証の/signinのHTMLが枠として保存されうる)。更新プロンプトを導入するとき（#478）。 |
| 任意のIDは、Service Workerがキャッシュキーを変えて `/rounds/_` の枠を返し、サーバーも `next.config.ts` のrewriteで同じ枠へ向ける | URLを変えずに枠を共有でき、`dynamicParams` が既定のままではIDごとのHTMLが永続化され続けるため（`dynamicParams = false` で固定する）。`proxy.ts` でのrewriteはCookieの複写が要るため採らない。 | 枠をIDごとに分ける必要が生じたとき。 |
| ナビゲーション以外とクロスオリジンのリクエストをService Workerへ通さない | 全体に一致するcatch-allがTurnstileの検証通信を拾い、検証が完了しなくなったため、全体を拾う設定をやめた。 | 通すべき外部リソースが生じたとき。 |
| 待機中の版を、内部リンクの操作の前に`SKIP_WAITING`(1回)で有効にしてから遷移させる。1秒(有効化待ちと保存の再確認の合計)で済まないときは、切り替えず旧版のまま遷移する。遷移の前に全経路を止める案は採らず、`<a>`のclickだけを止める。 | 待機させずに有効にすると、開いたままの旧版の画面を新SWが制御し遅延チャンクが欠けるため、即時の切り替えをやめた。Next.jsはデプロイ後のクライアント側の遷移をハードナビゲーションに落とし、その文書取得を待機中は旧SWが返して旧ビルドの枠が出るため、文書取得の前に有効にする。旧文書が新SWの下にいる時間は、`controllerchange`から文書取得までである。読み込み直しは保存の途中の操作を失わせうるため、直前にも保存を再確認する。`router.push`、戻る・進む、`location`の経路の差し替えは費用が大きいため採らない。合図の再送は、リンク操作を止めて画面のfetchが重ならないことと、保留を1秒に抑えるため削り、有効化が1秒で進まなければ現状維持として次の遷移で判定し直す。 | 更新プロンプトを導入するとき(#478)。`router.push`、戻る・進むを遷移の前に止められる仕組み(Next.jsの機能やNavigation API)が対象ブラウザで使えるとき。 |
| オンライン復帰時、ページをリロードせず(`reloadOnOnline` を無効にする)、offline表示の間だけ `online` イベントで枠内を自動再取得する。契機は `online` イベントだけにする。取得の途中で届いて受け取れなかった `online` は、`offline` に決まった時点で `navigator.onLine` が true ならすぐ再取得して補う | 内容は枠内で再取得するためページのリロードが要らず、展開中の入力を失わせるため。送信は `online` イベントで再送される。`offline` に決まる前の `online` は購読しても次が来ず、オンラインのまま表示が止まるため。errorは `online` で原因が解消せず、繰り返すと失敗の連打になる。`navigator.onLine` が true で通信できないときに状態から再試行すると、10秒ごとの再取得になる。端末のベースで表示している間は、`navigator.onLine`が`true`のまま通信が戻る場合のため、同期の`staleRetryDelayMs`の間隔でも取り直す(`rounds/detail`)。 | ページをキャッシュするとき。通信の復帰を `online` 以外で検知できるとき。errorの自動再試行が要るとき。 |
| `pnpm preview` で `serwist build` を実行する | プレビューとE2Eで古い、または存在しないService Workerが使われたため。 | Service Workerの生成手順を変えるとき。 |
| 未認証を取得結果に含めず、取得前に `readSession` で確かめ、未認証ではクエリを実行しない。未認証は、保存先にセッションが無いときと、サーバーが更新を拒否したと確定したときに限る。auth-jsの更新の破棄と、別の書き手と重なった拒否は、保存先を読み直して判定する | 遷移を取得関数と見張りの両方が行うと二重になるため、取得関数は遷移せず `error`（「サインインが必要です。」）を返す。セッションなしのクエリは匿名キーで送られ、RLSで0件になり、`not-found` と誤判定されるため、実行しない。更新の通信中に `proxy.ts` のSet-Cookieや別のタブが保存先を書き換えると、auth-jsは保存先に有効なセッションを残したままセッションなしを返すため。 | 取得関数が遷移を担う設計にするとき。クエリが認証なしの結果を区別して返すようになるとき。auth-jsが書き換えの重なりを自ら解決するようになったとき。 |
| `navigator.onLine` が false のときと `offline` イベントだけを `offline` とし、通信の失敗と取得全体の10秒の時間切れは原因を断定せず `error`（「読み込めませんでした。」、再試行可能）にする。回線が接続中でも外に出られない場合は自動復帰せず、再試行で復帰する | CDPのオフライン化とPlaywrightのsetOfflineのエミュレーションでは、オフラインのまま開いた文書の `navigator.onLine` が true のままで、`online` も `offline` も `navigator.connection` の `change` も届かないため、通信の失敗を「接続されていません」と断定できない。時間制限は、`navigator.onLine` が true のまま通信できないとき、期限切れのトークンの更新の再試行で約25秒、通信が応答しないと数分、枠が取得中のまま固定されるため。取得の結果に頼らない確認の待ち（開始時の認証確認、アプリの更新の切り替え）は1秒、取得の待ちは10秒にする。端末の保存(IndexedDB)の待ちは時間制限を持たず、古い版のタブが旧versionの接続や読み書きのトランザクションを閉じないと止まるため、一覧と詳細の読み込みの全体にも同じ10秒を掛ける。保存の待ちごとに上限を置いて端末の保存なしで内容を出す案は、送信器と保存の状態の扱いが増えるため採らない。 | 通信の復帰を `online` 以外で確実に検知できるとき。取得が10秒を超えるのが通常の回線が生じたとき。 |

## 制約と未対応

- `next.config.ts` と `serwist.config.mjs` が経路表(`routes.ts`)をNodeの型除去で読むため、Node 22.18以上が前提（`.node-version` は24）で、ビルド時に `MODULE_TYPELESS_PACKAGE_JSON` の警告が出る。
- Service Workerが未登録、または制御していないタブのオフラインは、ブラウザ標準のエラーになる。iOS Safariのホーム画面アプリでの挙動は実機で確認していない。
- 切り替えが1秒で進まない(`controllerchange`が来ない)ときと、保存が上限(1秒)までに終わらないときは、切り替えずに旧版のまま遷移し、その遷移では再び試みない。次の遷移で通常どおり判定する。登録の保持の前の操作も同じである。
- 複数のウィンドウを開いているとき、1つの遷移で切り替えると、他のウィンドウの旧ドキュメントを新しいService Workerが制御し、その遅延チャンクは取得できないことがある。そのウィンドウの通常の遷移(ハードナビゲーション)で回復する。
- 画面を遷移しない利用者(同じ画面のまま使い続ける、バックグラウンドから復帰しただけ)と、画面を開いただけ、`router.push`・戻る・進むだけの利用者には、次のリンク操作まで新しいビルドは届かない。
- リンクの操作で切り替える遷移は、最大1秒止まり、文書取得は1回で、遷移先は最初から新しいビルドで表示される。リンク以外の経路は切り替えず、旧ビルドの枠で表示する。
- 利用者の記録のオフライン表示は、詳細(保持するラウンド)とホーム(入力中のラウンド)を扱う。履歴はオフラインでラウンドを出さない。参照データは`rounds/start`が扱う。
- `navigator.onLine` が true のまま通信できないときは、取得の時間制限（10秒）まで枠は取得中のままで、その後に「読み込めませんでした。」と再試行ボタンを出す（保存済みがあれば、取得を待たずに保存済みを先に出す）。`online` イベントが来ないため自動再取得はせず、再試行ボタンで復帰する（端末のベースで表示するラウンド詳細は、間隔を置いて自動で取り直す）。時間切れ後に遅れて届いた結果は捨てる。
- 端末の保存の版更新が古い版のタブに塞がれている間(他のタブが読み書きを続けているときを含む)は、ホームと詳細が10秒後に「読み込めませんでした。」になり、取得できる内容があっても表示しない。塞がれている間、保存の内容は保持される。版更新の完了時は、既存の仕様どおり未送信を含む既存の保存内容が破棄される(移行は対象外)。
