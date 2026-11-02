"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { RoundsListStore } from "../application/rounds-list-store";
import type { RoundsStore } from "../application/rounds-store";

const RoundsStoreContext = createContext<RoundsStore | null>(null);
const RoundsListStoreContext = createContext<RoundsListStore | null>(null);

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

// 一覧の画面へ、状態と変更の方法を渡す。
export function RoundsListStoreProvider({
  store,
  children,
}: {
  store: RoundsListStore;
  children: ReactNode;
}) {
  return (
    <RoundsListStoreContext.Provider value={store}>
      {children}
    </RoundsListStoreContext.Provider>
  );
}

export function useRoundsListStore(): RoundsListStore {
  const store = useContext(RoundsListStoreContext);
  if (!store) throw new Error("RoundsListStoreProvider がありません。");
  return store;
}
