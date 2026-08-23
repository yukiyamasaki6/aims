# Feature Map (機能配置図)

[`screen-flow.md`](screen-flow.md)の各画面を、Next.js App Router（`apps/web/src/app`）上のコンポーネントとして配置した構成。デフォルトはServer Componentsとし、状態やイベントハンドラが必要な箇所のみ`"use client"`にする（[AGENTS.md](../AGENTS.md) 2章参照）。共通UIは`apps/web/src/components/ui/`（shadcn/ui）を再利用し、一覧性のため一部を割愛。

```
apps/web/src/app
├─ layout.tsx (Server)          ルートレイアウト、ヘッダー（Auth状態表示）
├─ page.tsx                     ルート（/rounds へ誘導）
├─ rounds/
│  ├─ page.tsx (Server)         ラウンド一覧
│  │  └─ RoundCard[]               日付・ラウンド名・合計点・X数
│  ├─ new/
│  │  └─ page.tsx (Client)      ラウンド作成フォーム
│  │     ├─ RoundNameInput         ラウンド名（自由記述。例: 第2回紅白戦）
│  │     └─ DistancePresetSelect    距離構成プリセット（70m 72射 等）
│  └─ [id]/
│     ├─ page.tsx (Server)      サマリー
│     │  ├─ ScoreSummary            合計 / X数 / 平均
│     │  └─ EndScoreTable           エンド別得点表
│     └─ record/
│        └─ page.tsx (Client)   スコア入力（コア体験）
│           ├─ CurrentEndHeader     現在の距離・エンド・累計
│           ├─ ScoreSheet           入力済みエンドの小計一覧
│           └─ ScoreKeypad          X, 10〜1, M の入力パネル
└─ components/ui/                shadcn/uiベースの共通コンポーネント
```

## 設計方針

- スコア入力画面（`record/page.tsx`）は連続入力の速度が最重要のため、確定後にページ遷移を挟まず`ScoreKeypad`からの入力を即座に`shots`へ反映する。
- 一覧・サマリー画面はServer Componentでデータ取得のみを行い、インタラクションを持たせない。
