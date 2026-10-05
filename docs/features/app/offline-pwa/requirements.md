# offline-pwa

| ID | Given | When | Then |
| :--- | :--- | :--- | :--- |
| offline-pwa-01 | 初回アクセス | /を開く | Service Workerが登録され、静的アセットと画面の枠がプリキャッシュされる |
| offline-pwa-02 | Manifestを満たしている | /を開く | ブラウザからアプリとしてインストールできる |
| offline-pwa-03 | Service Workerが登録済みで新しいビルドが存在する | Service Workerの更新を確認する | 新しいService Workerが待機せず即座に有効になり、新しいビルドが参照される |
| offline-pwa-04 | Service Workerが登録済みでオフライン | /を開く | /offlineページが表示される |
| offline-pwa-05 | 認証済み | manifestの`start_url`を開く | ラウンド一覧が表示される |
| offline-pwa-06 | 未認証 | manifestの`start_url`を開く | /signinへ遷移する |
| offline-pwa-07 | Service Workerが登録済みで認証済み | /rounds/[id]を開く | ラウンド詳細の枠が表示された後、内容が表示される |
| offline-pwa-08 | Service Workerが登録済みで認証済みでオフライン | /roundsを開く | ラウンド一覧の枠と「ネットワークに接続されていません」が表示される |
| offline-pwa-09 | Service Workerが登録済みで認証済みでオフライン | /rounds/newを開く | ラウンド開始の枠と「ネットワークに接続されていません」が表示される |
| offline-pwa-10 | Service Workerが登録済みで認証済みでオフラインで、作成が確定済みのラウンド | /rounds/[id]を開く | ラウンド詳細の枠と「ネットワークに接続されていません」が表示される |
| offline-pwa-11 | 未認証でService Workerが登録された後にサインインしてオフライン | /roundsを開く | ラウンド一覧の枠と「ネットワークに接続されていません」が表示される(サインイン画面は表示されない) |
| offline-pwa-14 | Service Workerが登録済みで認証済みでオフラインの/roundsの枠に「ネットワークに接続されていません」が表示されている | オンラインへ復帰する | ラウンド一覧の内容が表示される<br>「ネットワークに接続されていません」が表示されなくなる |
| offline-pwa-15 | Service Workerが登録済みで認証済みでオフラインの/rounds/newの枠に「ネットワークに接続されていません」が表示されている | オンラインへ復帰する | プリセット一覧が表示される<br>「ネットワークに接続されていません」が表示されなくなる |
| offline-pwa-16 | Service Workerが登録済みで認証済みでオフラインで、作成が確定済みのラウンドの/rounds/[id]の枠に「ネットワークに接続されていません」が表示されている | オンラインへ復帰する | ラウンド詳細の内容が表示される<br>「ネットワークに接続されていません」が表示されなくなる |
| offline-pwa-12 | Service Workerが登録済みで未認証 | /rounds/[id]を開く | /signinへ遷移する |
| offline-pwa-13 | Service Workerが登録済みでセッションが期限切れ | /roundsを開く | /signinへ遷移する |
