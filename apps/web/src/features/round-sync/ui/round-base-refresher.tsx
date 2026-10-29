"use client";

import { useEffect, useState } from "react";
import type { RoundSync } from "../application/round-sync";

// 端末が、入力中のラウンドをオフラインで開けるよう行う常駐の一括の取得の、成功の回数を出す。何も表示しない。
// 取得の契機は同期の手続きが決める。成功の回数は、取得の完了を確かめる手段として出す。
export function RoundBaseRefresher({ sync }: { sync: RoundSync }) {
  const [refreshed, setRefreshed] = useState(0);

  useEffect(() => sync.subscribeRefreshed(setRefreshed), [sync]);

  return (
    <span
      hidden
      data-testid="round-base-refresher"
      data-refreshed-count={refreshed}
    />
  );
}
