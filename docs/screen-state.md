# Screen State (画面状態遷移図)

- `〇` テスト済み
- `△` テスト漏れ
- `⚠` 実装漏れ

## `/` 紹介画面

```mermaid
stateDiagram-v2
    direction LR
    state "/rounds" as Rounds
    state "/signup" as SignUp

    [*] --> 紹介画面: 未認証
    [*] --> Rounds: 認証済み

    紹介画面 --> SignUp: 開始ボタン

    classDef external stroke-dasharray: 4 4
    class Rounds,SignUp external
```

| イベント | 初期 |  | 紹介画面 |  |
| :--- | :---: | :---: | :---: | :---: |
| 未認証でアクセス | 紹介画面 | 〇 | - |  |
| 認証済みでアクセス | /rounds | 〇 | - |  |
| 開始ボタン | - |  | /signup | 〇 |

## `/signin` サインイン画面

```mermaid
stateDiagram-v2
    direction LR
    state "/rounds" as Rounds
    state "/reset-password" as ResetPassword
    state "/signup" as SignUp

    [*] --> 未送信: 未認証
    [*] --> Rounds: 認証済み

    state c1 <<choice>>
    未送信 --> c1: サインインボタン
    c1 --> 送信中: [適正]
    c1 --> 未送信: [不正]

    未送信 --> ResetPassword: PW再設定リンク
    未送信 --> SignUp: サインアップリンク

    送信中 --> 未送信: 送信失敗
    送信中 --> Rounds: 送信成功

    classDef external stroke-dasharray: 4 4
    class Rounds,ResetPassword,SignUp external
```

| イベント | 初期 |  | 未送信 |  | 送信中 |  |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 未認証でアクセス | 未送信 | 〇 | - |  | - |  |
| 認証済みでアクセス | /rounds | 〇 | - |  | - |  |
| サインインボタン[入力不備] | - |  | （メッセージ表示） | 〇 | - |  |
| サインインボタン[captcha未完了] | - |  | （メッセージ表示） | 〇 | - |  |
| サインインボタン[エラー切り替え] | - |  | （メッセージ表示） | 〇 | - |  |
| サインインボタン[適正] | - |  | 送信中 | 〇 | 無効 | 〇 |
| PW再設定リンク | - |  | /reset-password | 〇 | - |  |
| サインアップリンク | - |  | /signup | 〇 | - |  |
| 送信失敗 | - |  | - |  | 未送信（メッセージ表示） | 〇 |
| 送信成功 | - |  | - |  | /rounds | 〇 |

## `/signup` サインアップ画面

### 初期アクセス

```mermaid
stateDiagram-v2
    direction LR
    state "メール入力" as EmailStep
    state "/rounds" as Rounds

    [*] --> EmailStep: 未認証
    [*] --> Rounds: 認証済み

    classDef external stroke-dasharray: 4 4
    class EmailStep,Rounds external
```

| イベント | 初期 |  |
| :--- | :---: | :---: |
| 未認証でアクセス | メール入力 | 〇 |
| 認証済みでアクセス | /rounds | 〇 |

### メール入力

```mermaid
stateDiagram-v2
    direction LR
    state "/signin" as SignIn
    state "コード入力" as CodeStep

    [*] --> 未登録

    state c1 <<choice>>
    未登録 --> c1: 送信ボタン
    c1 --> 送信中: [適正]
    c1 --> 未登録: [不正]

    未登録 --> SignIn: サインインリンク

    送信中 --> 未登録: 送信失敗
    送信中 --> CodeStep: 送信成功

    classDef external stroke-dasharray: 4 4
    class SignIn,CodeStep external
```

| イベント | 未登録 |  | 送信中 |  |
| :--- | :---: | :---: | :---: | :---: |
| 送信ボタン[入力不備] | （メッセージ表示） | 〇 | - |  |
| 送信ボタン[captcha未完了] | （メッセージ表示） | 〇 | - |  |
| 送信ボタン[適正] | 送信中 | 〇 | 無効 | 〇 |
| サインインリンク | /signin | 〇 | - |  |
| 送信失敗[登録済みメールアドレス] | - |  | 未登録（メッセージ表示） | 〇 |
| 送信失敗 | - |  | 未登録（メッセージ表示） | 〇 |
| 送信成功[未確認メールの再送信] | - |  | コード入力 | 〇 |
| 送信成功 | - |  | コード入力 | 〇 |

### コード入力

```mermaid
stateDiagram-v2
    direction LR
    state "メール入力" as EmailStep
    state "パスワード設定" as PasswordStep

    [*] --> 未確認

    state c1 <<choice>>
    未確認 --> c1: 確認ボタン
    c1 --> 確認中: [適正]
    c1 --> 未確認: [不正]

    state c2 <<choice>>
    未確認 --> c2: 再送ボタン
    c2 --> 再送中: [適正]
    c2 --> 未確認: [不正]

    未確認 --> EmailStep: 戻るボタン

    確認中 --> 未確認: 確認失敗
    確認中 --> PasswordStep: 確認成功

    再送中 --> 未確認: 再送失敗
    再送中 --> 未確認: 再送成功

    classDef external stroke-dasharray: 4 4
    class EmailStep,PasswordStep external
```

| イベント | 未確認 |  | 確認中 |  | 再送中 |  |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 確認ボタン[コード未入力] | （メッセージ表示） | 〇 | - |  | - |  |
| 確認ボタン[適正] | 確認中 | 〇 | 無効 | 〇 | - |  |
| 再送ボタン[クールダウン中] | （メッセージ表示） | 〇 | - |  | - |  |
| 再送ボタン[captcha未完了] | （メッセージ表示） | 〇 | - |  | - |  |
| 再送ボタン[適正] | 再送中 | 〇 | - |  | 無効 | 〇 |
| 戻るボタン | メール入力 | 〇 | - |  | - |  |
| 確認失敗 | - |  | 未確認（メッセージ表示） | 〇 | - |  |
| 確認成功 | - |  | パスワード設定 | 〇 | - |  |
| 再送失敗 | - |  | - |  | 未確認（メッセージ表示） | 〇 |
| 再送成功 | - |  | - |  | 未確認（確認メッセージなし） | 〇 |

### パスワード設定

```mermaid
stateDiagram-v2
    direction LR
    state "/rounds" as Rounds

    [*] --> 未送信

    state c1 <<choice>>
    未送信 --> c1: 登録ボタン
    c1 --> 送信中: [適正]
    c1 --> 未送信: [不正]

    送信中 --> 未送信: 送信失敗
    送信中 --> Rounds: 送信成功

    classDef external stroke-dasharray: 4 4
    class Rounds external
```

| イベント | 未送信 |  | 送信中 |  |
| :--- | :---: | :---: | :---: | :---: |
| 登録ボタン[パスワード不備] | （メッセージ表示） | 〇 | - |  |
| 登録ボタン[適正] | 送信中 | 〇 | 無効 | 〇 |
| 送信失敗 | - |  | 未送信（メッセージ表示） | 〇 |
| 送信成功 | - |  | /rounds | 〇 |

## `/reset-password` パスワード再設定画面

### 初期アクセス

```mermaid
stateDiagram-v2
    direction LR
    state "メール入力" as EmailStep
    state "/rounds" as Rounds

    [*] --> EmailStep: 未認証
    [*] --> Rounds: 認証済み

    classDef external stroke-dasharray: 4 4
    class EmailStep,Rounds external
```

| イベント | 初期 |  |
| :--- | :---: | :---: |
| 未認証でアクセス | メール入力 | 〇 |
| 認証済みでアクセス | /rounds | 〇 |

### メール入力

```mermaid
stateDiagram-v2
    direction LR
    state "/signin" as SignIn
    state "コード入力" as CodeStep

    [*] --> 未送信

    state c1 <<choice>>
    未送信 --> c1: 送信ボタン
    c1 --> 送信中: [適正]
    c1 --> 未送信: [不正]

    未送信 --> SignIn: サインインリンク

    送信中 --> 未送信: 送信失敗
    送信中 --> CodeStep: 送信成功

    classDef external stroke-dasharray: 4 4
    class SignIn,CodeStep external
```

| イベント | 未送信 |  | 送信中 |  |
| :--- | :---: | :---: | :---: | :---: |
| 送信ボタン[入力不備] | （メッセージ表示） | 〇 | - |  |
| 送信ボタン[captcha未完了] | （メッセージ表示） | 〇 | - |  |
| 送信ボタン[適正] | 送信中 | 〇 | 無効 | 〇 |
| サインインリンク | /signin | 〇 | - |  |
| 送信失敗 | - |  | 未送信（メッセージ表示） | 〇 |
| 送信成功 | - |  | コード入力 | 〇 |

### コード入力

```mermaid
stateDiagram-v2
    direction LR
    state "メール入力" as EmailStep
    state "パスワード設定" as PasswordStep

    [*] --> 未確認

    state c1 <<choice>>
    未確認 --> c1: 確認ボタン
    c1 --> 確認中: [適正]
    c1 --> 未確認: [不正]

    state c2 <<choice>>
    未確認 --> c2: 再送ボタン
    c2 --> 再送中: [適正]
    c2 --> 未確認: [不正]

    未確認 --> EmailStep: 戻るボタン

    確認中 --> 未確認: 確認失敗
    確認中 --> PasswordStep: 確認成功

    再送中 --> 未確認: 再送失敗
    再送中 --> 未確認: 再送成功

    classDef external stroke-dasharray: 4 4
    class EmailStep,PasswordStep external
```

| イベント | 未確認 |  | 確認中 |  | 再送中 |  |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 確認ボタン[コード未入力] | （メッセージ表示） | 〇 | - |  | - |  |
| 確認ボタン[適正] | 確認中 | 〇 | 無効 | 〇 | - |  |
| 再送ボタン[クールダウン中] | （メッセージ表示） | 〇 | - |  | - |  |
| 再送ボタン[captcha未完了] | （メッセージ表示） | 〇 | - |  | - |  |
| 再送ボタン[適正] | 再送中 | 〇 | - |  | 無効 | 〇 |
| 戻るボタン | メール入力 | 〇 | - |  | - |  |
| 確認失敗 | - |  | 未確認（メッセージ表示） | 〇 | - |  |
| 確認成功 | - |  | パスワード設定 | 〇 | - |  |
| 再送失敗 | - |  | - |  | 未確認（メッセージ表示） | 〇 |
| 再送成功 | - |  | - |  | 未確認（確認メッセージなし） | 〇 |

### パスワード設定

```mermaid
stateDiagram-v2
    direction LR
    state "/signin" as SignIn

    [*] --> 未送信

    state c1 <<choice>>
    未送信 --> c1: 変更ボタン
    c1 --> 送信中: [適正]
    c1 --> 未送信: [不正]

    送信中 --> 未送信: 送信失敗
    送信中 --> SignIn: 送信成功

    classDef external stroke-dasharray: 4 4
    class SignIn external
```

| イベント | 未送信 |  | 送信中 |  |
| :--- | :---: | :---: | :---: | :---: |
| 変更ボタン[パスワード不備] | （メッセージ表示） | 〇 | - |  |
| 変更ボタン[適正] | 送信中 | 〇 | 無効 | 〇 |
| 送信失敗 | - |  | 未送信（メッセージ表示） | 〇 |
| 送信成功 | - |  | /signin | 〇 |

## レフトパネル

### モバイル表示（`md`未満）

```mermaid
stateDiagram-v2
    direction LR
    state "/rounds" as Rounds
    state "サインアウト確認" as SignOutFlow

    [*] --> 格納

    展開 --> 格納: 閉じるボタン
    展開 --> 格納: オーバーレイクリック
    展開 --> Rounds: AIMSリンク
    展開 --> Rounds: 自分リンク
    展開 --> SignOutFlow: サインアウトボタン

    格納 --> 展開: ハンバーガーボタン

    classDef external stroke-dasharray: 4 4
    class Rounds,SignOutFlow external
```

| イベント | 初期 |  | 展開 |  | 格納 |  |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 初期表示 | 格納 | 〇 | - |  | - |  |
| 閉じるボタン | - |  | 格納 | 〇 | - |  |
| オーバーレイクリック | - |  | 格納 | 〇 | - |  |
| AIMSリンク | - |  | /rounds | 〇 | 無効 | 〇 |
| 自分リンク | - |  | /rounds | 〇 | 無効 | 〇 |
| サインアウトボタン | - |  | サインアウト確認 | 〇 | 無効 | 〇 |
| ハンバーガーボタン | - |  | - |  | 展開 | 〇 |

### デスクトップ表示（`md`以上）

```mermaid
stateDiagram-v2
    direction LR
    state "/rounds" as Rounds
    state "サインアウト確認" as SignOutFlow

    [*] --> 展開

    展開 --> 格納: 格納ボタン
    展開 --> Rounds: AIMSリンク
    展開 --> Rounds: 自分リンク
    展開 --> SignOutFlow: サインアウトボタン

    格納 --> 展開: 開くボタン

    classDef external stroke-dasharray: 4 4
    class Rounds,SignOutFlow external
```

| イベント | 初期 |  | 展開 |  | 格納 |  |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 初期表示 | 展開 | 〇 | - |  | - |  |
| 格納ボタン | - |  | 格納 | 〇 | - |  |
| AIMSリンク | - |  | /rounds | 〇 | 無効 | 〇 |
| 自分リンク | - |  | /rounds | 〇 | 無効 | 〇 |
| サインアウトボタン | - |  | サインアウト確認 | 〇 | 無効 | 〇 |
| 開くボタン | - |  | - |  | 展開 | 〇 |

### サインアウト確認

```mermaid
stateDiagram-v2
    direction LR
    state "/" as Landing

    [*] --> 確認ダイアログ

    確認ダイアログ --> [*]: キャンセル<br/>（ダイアログを閉じる）
    確認ダイアログ --> [*]: 背景クリック<br/>（ダイアログを閉じる）
    確認ダイアログ --> 送信中: 確認ボタン

    送信中 --> 確認ダイアログ: 送信失敗
    送信中 --> Landing: 送信成功

    classDef external stroke-dasharray: 4 4
    class Landing external
```

| イベント | 確認ダイアログ |  | 送信中 |  |
| :--- | :---: | :---: | :---: | :---: |
| キャンセル | ダイアログを閉じる | 〇 | 無効 | 〇 |
| 背景クリック | ダイアログを閉じる | 〇 | 無効 | 〇 |
| 確認ボタン | 送信中 | 〇 | 無効 | 〇 |
| 送信失敗[通信エラー] | - |  | 確認ダイアログ（メッセージ表示） | 〇 |
| 送信成功 | - |  | / | 〇 |
