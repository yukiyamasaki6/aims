"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { UpdateActivation } from "../application/update-activation";

// 画面の経路の変化を、更新の切り替えの手続きへ知らせる。表示は行わない。
export function SwUpdateActivator({
  activation,
}: {
  activation: UpdateActivation;
}) {
  const pathname = usePathname();

  // biome-ignore lint/correctness/useExhaustiveDependencies: パスの変化(画面の遷移)を契機に実行するため、本体で読まないpathnameを依存にする
  useEffect(() => {
    activation.pathChanged();
  }, [pathname]);

  return null;
}
