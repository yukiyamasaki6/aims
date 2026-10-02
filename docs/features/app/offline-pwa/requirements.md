# offline-pwa

| ID | Given | When | Then |
| :--- | :--- | :--- | :--- |
| offline-pwa-01 | 初回アクセス | /を開く | Service Workerが登録され、静的アセットがプリキャッシュされる |
| offline-pwa-02 | Manifestを満たしている | /を開く | ブラウザからアプリとしてインストールできる |
| offline-pwa-03 | Service Workerが登録済みで新しいビルドが存在する | Service Workerの更新を確認する | 新しいService Workerが待機せず即座に有効になり、新しいビルドが参照される |
| offline-pwa-04 | Service Workerが登録済みでオフライン | /を開く | /offlineページが表示される |
| offline-pwa-05 | 認証済み | manifestの`start_url`を開く | ラウンド一覧が表示される |
| offline-pwa-06 | 未認証 | manifestの`start_url`を開く | /signinへ遷移する |
