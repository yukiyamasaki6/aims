# Screen Flow (画面遷移図)

画面ごとの詳細・実装状況はfeature-map.mdを参照。

## 認証フロー

```mermaid
flowchart TD
    SignIn["/signin<br/>サインイン画面"]
    SignUp["/signup<br/>サインアップ画面<br/>（メール→認証コード→パスワード設定の3ステップ）"]
    ResetPass["/reset-password<br/>パスワード再設定画面<br/>（メール→認証コード→新パスワードの3ステップ）"]
    MainApp["メイン画面へ<br/>（/rounds）"]

    SignIn <--> SignUp
    SignIn --> ResetPass
    SignIn -->|サインイン成功| MainApp
    SignUp -->|登録完了| MainApp
    ResetPass -->|設定完了| SignIn
```

各ステップは同一URL内のクライアント側の状態遷移であり、ステップごとに別URLは持たない（`/signup`と同じパターン）。

## メイン画面遷移（レフトパネル起点）

`/rounds`・`/teams/[teamId]/rounds`のタブ構成は後述の「個人コンテキストのタブ構成」「チームコンテキストのタブ構成」を参照。`/teams`配下のチーム参加・作成の詳細は「チーム参加・作成」を参照。

```mermaid
flowchart TD
    Nav["レフトパネル<br/>（グローバルナビゲーション）"]
    PRounds["/rounds<br/>個人コンテキスト"]
    TRounds["/teams/[teamId]/rounds<br/>チームコンテキスト"]
    TMgmt["/teams/[teamId]<br/>チーム管理画面"]
    TExplore["/teams<br/>チーム参加・作成"]
    Settings["/settings<br/>設定画面"]
    Legal["/legal<br/>利用規約・プライバシーポリシー画面"]
    Feedback["/feedback<br/>不具合報告・要望フォーム"]
    SignIn["/signin<br/>サインイン画面"]
    RNew["/rounds/new<br/>ラウンド新規作成画面"]
    RDetail["/rounds/[id]<br/>ラウンド入力・閲覧統合画面"]

    Nav -->|個人コンテキスト選択| PRounds
    Nav -->|チームコンテキスト選択| TRounds
    Nav -->|チーム管理| TMgmt
    Nav -->|チーム探索・参加| TExplore
    Nav -->|設定| Settings
    Nav -->|規約| Legal
    Nav -->|要望・報告| Feedback
    Nav -->|サインアウト| SignIn

    PRounds -->|新規作成| RNew
    PRounds -->|詳細・編集| RDetail
    TRounds -->|新規作成| RNew
    TRounds -->|詳細・編集| RDetail
    RNew -->|作成完了| RDetail
    RDetail -->|完了・戻る| PRounds
    RDetail -->|完了・戻る| TRounds
```

## 個人コンテキストのタブ構成

```mermaid
flowchart TD
    PSwitcher["サブスイッチャー<br/>（タブ切替）"]
    PRounds["/rounds<br/>ラウンド一覧（履歴）"]
    PTrend["/rounds/trend<br/>推移"]
    PStats["/rounds/stats<br/>統計分析"]
    PAI["/rounds/ai<br/>AI分析"]

    PSwitcher <--> PRounds
    PSwitcher <--> PTrend
    PSwitcher <--> PStats
    PSwitcher <--> PAI
```

## チームコンテキストのタブ構成

```mermaid
flowchart TD
    TSwitcher["サブスイッチャー<br/>（タブ切替）"]
    TRounds["/teams/[teamId]/rounds<br/>ラウンド一覧（履歴）"]
    TTrend["/teams/[teamId]/rounds/trend<br/>推移"]
    TRanking["/teams/[teamId]/rounds/ranking<br/>ランキング"]
    TMatch["/teams/[teamId]/rounds/team-match<br/>団体戦"]
    TStats["/teams/[teamId]/rounds/stats<br/>統計分析"]
    TAI["/teams/[teamId]/rounds/ai<br/>AI分析"]

    TSwitcher <--> TRounds
    TSwitcher <--> TTrend
    TSwitcher <--> TRanking
    TSwitcher <--> TMatch
    TSwitcher <--> TStats
    TSwitcher <--> TAI
```

## チーム参加・作成

```mermaid
flowchart TD
    TExplore["/teams<br/>公開チーム一覧・検索画面"]
    TCreate["/teams/new<br/>チーム作成画面"]
    TJoinCode["/teams/join/[code]<br/>参加確認・処理画面"]
    TRounds["/teams/[teamId]/rounds<br/>チームコンテキストへ"]

    TExplore --> TCreate
    TExplore --> TJoinCode
    TCreate -->|作成完了| TRounds
    TJoinCode -->|参加完了| TRounds
```
