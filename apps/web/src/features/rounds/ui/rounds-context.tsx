"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { RoundsStore } from "../application/rounds-store";

const RoundsStoreContext = createContext<RoundsStore | null>(null);

// 画面へ、ラウンドの状態と変更の方法を渡す。
export function RoundsStoreProvider({
  store,
  children,
}: {
  store: RoundsStore;
  children: ReactNode;
}) {
  return (
    <RoundsStoreContext.Provider value={store}>
      {children}
    </RoundsStoreContext.Provider>
  );
}

export function useRoundsStore(): RoundsStore {
  const store = useContext(RoundsStoreContext);
  if (!store) throw new Error("RoundsStoreProvider がありません。");
  return store;
}
