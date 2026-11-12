"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { HistoryViewMemory } from "../application/history-view-memory";
import type { PresetDeletion } from "../application/preset-deletion";
import type { PresetSaving } from "../application/preset-saving";
import type { RoundDeletion } from "../application/round-deletion";
import type { RoundFetching } from "../application/round-fetching";
import type { RoundLeaving } from "../application/round-leaving";
import type { RoundStart } from "../application/round-start";
import type { RoundWindow } from "../application/round-window";
import type { RoundsListStore } from "../application/rounds-list-store";
import type { UniqueIds } from "../application/unique-ids";
import type { WhenOnline } from "../application/when-online";

// 画面が窓口を通さずに使う手続き。離れる(完了、削除)、ラウンドの削除(一覧)、開始、プリセットの保存・削除・取得、IDの払い出し、オンライン復帰の通知、履歴の条件の記憶。
export type RoundProcedures = {
  leaving: RoundLeaving;
  deletion: RoundDeletion;
  roundStart: RoundStart;
  presetSaving: PresetSaving;
  presetDeletion: PresetDeletion;
  fetching: Pick<RoundFetching, "fetchPresets" | "savedPresets">;
  ids: UniqueIds;
  whenOnline: WhenOnline;
  historyViewMemory: HistoryViewMemory;
  // そのエンドの既にある矢のIDより後ろに並ぶ、時刻順の矢のIDの払い出し。
  newShotId: (endShotIds: readonly string[]) => string;
};

const RoundWindowContext = createContext<RoundWindow | null>(null);
const RoundsListStoreContext = createContext<RoundsListStore | null>(null);
const RoundProceduresContext = createContext<RoundProcedures | null>(null);

// 画面へ、端末内の取得と同期の窓口を渡す。
export function RoundWindowProvider({
  roundWindow,
  children,
}: {
  roundWindow: RoundWindow;
  children: ReactNode;
}) {
  return (
    <RoundWindowContext.Provider value={roundWindow}>
      {children}
    </RoundWindowContext.Provider>
  );
}

export function useRoundWindow(): RoundWindow {
  const roundWindow = useContext(RoundWindowContext);
  if (!roundWindow) throw new Error("RoundWindowProvider がありません。");
  return roundWindow;
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
