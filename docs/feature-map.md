# Feature Map (機能配置図)

```
apps/web/src/app
├─ layout.tsx (Server)          ルートレイアウト
├─ page.tsx                     ルート（認証状態で/roundsまたは/signinへリダイレクト。未実装・現状は静的ランディング）
├─ (auth)/
│  ├─ layout.tsx (Server)       認証用レイアウト（LeftPanelなし）
│  ├─ signin/
│  │  └─ page.tsx (Client)      サインイン画面（/signupへの導線）
│  ├─ signup/
│  │  └─ page.tsx (Client)      サインアップ画面。email/code/passwordの3ステップをクライアント側stateで管理し、単一URLのまま画面を出し分ける（別URLは持たない）
│  └─ reset-password/
│     └─ page.tsx (Client)      パスワード再設定画面。`signup/page.tsx`と同じ3ステップ構成で実装予定（未実装）
├─ (main)/
│  ├─ layout.tsx (Server)       ヘッダーに結合ボタン(ハンバーガー+コンテキスト名。左上・常時表示)を配置
│  │  └─ LeftPanel (Client)        結合ボタンから開閉（PC常時展開・モバイルはドロワー）。上から: 自分 → 所属チーム一覧(行右端にメニューボタン。タップで`[teamId]`(チーム管理画面)へ) → 区切り線 → 「チーム参加・作成」ボタン(`/teams`へ) → 区切り線 → 設定・規約・要望へのリンク → サインアウトボタン
│  ├─ rounds/                   個人コンテキスト。共通UI: サブスイッチャー(タブ切替: 履歴/推移/統計分析/AI分析)、NewRoundFab(右下固定・常時表示、タップで`new/`へ)
│  │  ├─ page.tsx (Client)      履歴タブ: ラウンド一覧
│  │  │  └─ RoundCard[]            日付・ラウンド名・合計点・X数の一覧
│  │  ├─ trend/
│  │  │  └─ page.tsx (Client)   推移タブ: 得点推移グラフ
│  │  ├─ stats/
│  │  │  └─ page.tsx (Client)   統計分析タブ
│  │  ├─ ai/
│  │  │  └─ page.tsx (Client)   AI分析タブ
│  │  ├─ new/
│  │  │  └─ page.tsx (Client)   ラウンド作成（個人・チーム両コンテキストで共用）
│  │  │     ├─ RoundNameInput      ラウンド名（自由記述。例: 第2回紅白戦）
│  │  │     └─ DistancePresetSelect 距離構成プリセット（70m 72射 等）
│  │  └─ [id]/
│  │     └─ page.tsx (Client)   ラウンド入力・閲覧の統合画面（コンテキストに依存しない共通の着地点）
│  │        ├─ CurrentEndHeader    現在の距離・エンド・累計、X/10カウント
│  │        ├─ ScoreSheet          入力済みエンドの小計一覧（全距離分）
│  │        └─ ScoreKeypad         X, 10〜1, M の入力パネル（未入力がある間のみ表示）
│  ├─ teams/
│  │  ├─ page.tsx (Client)      公開チーム一覧・検索画面（チーム参加・作成の起点）
│  │  ├─ new/
│  │  │  └─ page.tsx (Client)   チーム作成画面
│  │  ├─ join/
│  │  │  └─ [code]/
│  │  │     └─ page.tsx (Client) 招待コード参加確認・処理画面
│  │  └─ [teamId]/
│  │     ├─ page.tsx (Client)   チーム管理画面（※NewRoundFabは表示しない）
│  │     │  ├─ TeamInviteCode      チーム名・公開設定・招待コード再発行
│  │     │  ├─ MemberList          メンバー一覧（全員閲覧可）
│  │     │  └─ MemberRoleControl   権限変更・追放（editorのみ）
│  │     └─ rounds/              チームコンテキスト。共通UI: サブスイッチャー(タブ切替: 履歴/推移/ランキング/団体戦/統計分析/AI分析)、NewRoundFab(`/rounds/new`へ)
│  │        ├─ page.tsx (Client)   履歴タブ: ラウンド一覧
│  │        ├─ trend/page.tsx (Client)    推移タブ
│  │        ├─ ranking/page.tsx (Client)  ランキングタブ
│  │        ├─ team-match/page.tsx (Client) 団体戦タブ
│  │        ├─ stats/page.tsx (Client)    統計分析タブ
│  │        └─ ai/page.tsx (Client)       AI分析タブ
│  ├─ settings/
│  │  └─ page.tsx (Client)      設定画面（プロフィール・メール変更・アカウント削除・テーマ・通知・言語等を1画面に集約）
│  ├─ legal/
│  │  └─ page.tsx (Client)      利用規約・プライバシーポリシー画面
│  └─ feedback/
│     └─ page.tsx (Client)      不具合報告・要望フォーム
└─ components/ui/                shadcn/uiベースの共通コンポーネント
```

## 設計方針

- 認証前後でレイアウトを分けるため`(auth)` / `(main)`のroute groupsを用いる（`()`はURLに現れないため、ルーティングへの影響はない）。`(auth)`はLeftPanelなしの最小レイアウト、`(main)`は`LeftPanel`を含むレイアウトを持つ。
- ラウンド入力・閲覧の統合画面（`rounds/[id]/page.tsx`）は連続入力の速度が最重要のため、確定後にページ遷移を挟まず`ScoreKeypad`からの入力を即座に`shots`へ反映する。
- 独立したサマリー専用画面は設けない。ラウンド入力・閲覧の統合画面がそのまま閲覧・サマリーを兼ね、全エンド入力完了後も同じ画面で内訳を確認できる。ラウンド一覧の`RoundCard`が日付・ラウンド名・合計点を表示することでサマリーの代わりとする。
- 推移・ランキング・団体戦・統計分析・AI分析は、`rounds`配下のサブルートとしてそれぞれ独立したページに配置し、状態ではなくURLでタブを表現する。個人コンテキストにはランキング・団体戦は無く、統計分析・AI分析は個人・チーム双方に存在する。
- ラウンド作成（`/rounds/new`）とラウンド入力・閲覧（`/rounds/[id]`）は個人・チーム両コンテキストで共用する単一の画面であり、チームコンテキスト側に別のURLを持たない。
- `LeftPanel`の開閉は`(main)`配下のどの画面でも共通の状態変化であり、個別の画面遷移としては扱わない。
