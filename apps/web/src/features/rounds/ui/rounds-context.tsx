"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { NewRoundStore } from "../application/new-round-store";
import type { PresetSaving } from "../application/preset-saving";
import type { RoundDetailStore } from "../application/round-detail-store";
import type { RoundLeaving } from "../application/round-leaving";
import type { RoundsListStore } from "../application/rounds-list-store";
import type { UniqueIds } from "../application/unique-ids";

// 詳細の画面が窓口を通さずに使う手続き。離れる(完了、削除、一覧へ戻る)、プリセットの保存、IDの払い出し。
export type RoundProcedures = {
  leaving: RoundLeaving;
  presetSaving: PresetSaving;
  ids: UniqueIds;
};

const RoundDetailStoreContext = createContext<RoundDetailStore | null>(null);
const RoundsListStoreContext = createContext<RoundsListStore | null>(null);
const NewRoundStoreContext = createContext<NewRoundStore | null>(null);
const RoundProceduresContext = createContext<RoundProcedures | null>(null);

// 詳細の画面へ、状態と変更の方法を渡す。
export function RoundDetailStoreProvider({
  store,
  children,
}: {
  store: RoundDetailStore;
  children: ReactNode;
}) {
  return (
    <RoundDetailStoreContext.Provider value={store}>
      {children}
    </RoundDetailStoreContext.Provider>
  );
}

export function useRoundDetailStore(): RoundDetailStore {
  const store = useContext(RoundDetailStoreContext);
  if (!store) throw new Error("RoundDetailStoreProvider がありません。");
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

// 作成の画面へ、状態と変更の方法を渡す。
export function NewRoundStoreProvider({
  store,
  children,
}: {
  store: NewRoundStore;
  children: ReactNode;
}) {
  return (
    <NewRoundStoreContext.Provider value={store}>
      {children}
    </NewRoundStoreContext.Provider>
  );
}

export function useNewRoundStore(): NewRoundStore {
  const store = useContext(NewRoundStoreContext);
  if (!store) throw new Error("NewRoundStoreProvider がありません。");
  return store;
}

// 詳細の画面へ、窓口を通さない手続きを渡す。
export function RoundProceduresProvider({
  procedures,
  children,
}: {
  procedures: RoundProcedures;
  children: ReactNode;
}) {
  return (
    <RoundProceduresContext.Provider value={procedures}>
      {children}
    </RoundProceduresContext.Provider>
  );
}

export function useRoundProcedures(): RoundProcedures {
  const procedures = useContext(RoundProceduresContext);
  if (!procedures) throw new Error("RoundProceduresProvider がありません。");
  return procedures;
}
