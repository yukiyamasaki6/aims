"use client";

import { IntroScreen } from "@/features/introduction/ui/intro-screen";

// 紹介画面は静的で、認証状態によらず同じ内容である。「記録を始める」とヘッダーのリンクは固定の行き先で、認証済みなら転送で一覧へ着く。
export default function Home() {
  return <IntroScreen />;
}
