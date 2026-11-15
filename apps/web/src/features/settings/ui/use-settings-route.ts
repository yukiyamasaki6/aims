"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { SETTINGS_ACCOUNT_HASH } from "@/routes";
import {
  type SettingsView,
  settingsDepthOf,
  settingsHashOf,
  settingsHistoryStateOf,
  settingsLocationOf,
} from "../domain/settings-location";

// 設定パネルが閉じたときの、キーボードのフォーカスの戻し先の種類。
// opener: 開き口(「設定」項目かメニューボタン)。content: 背景の画面の先頭(本文領域)。
type SettingsCloseFocus = "opener" | "content";

// 設定パネルの経路の操作。
// view: 開いている表示。閉じているときはnull。
// open: 分類「アカウント」で開く。move: パネルの中で移る。どちらも今と同じ表示へは積まない。
// close: 起点まで履歴を戻して閉じる。closeFocus: 直近に閉じたときの戻し先の種類。
export type SettingsRoute = {
  view: SettingsView | null;
  closeFocus: SettingsCloseFocus;
  open(): void;
  move(view: SettingsView): void;
  close(): void;
};

type Snapshot = { hash: string; closeFocus: SettingsCloseFocus };

// 事前描画と水和では閉じている(枠は静的なため、開くのは水和の後)。
const SERVER_SNAPSHOT: Snapshot = { hash: "", closeFocus: "opener" };

// 文書の読み込みごとに作る識別子。再読み込みの後に、前の文書が積んだ項目の段数で戻りすぎないために、積んだ項目に記す。
let documentId: string | null = null;

function currentDocumentId(): string {
  documentId ??= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return documentId;
}

function urlWithHash(hash: string): string {
  return window.location.pathname + window.location.search + hash;
}

// 今のハッシュと閉じたときの戻し先の種類の値と、その購読。購読の間、popstateとhashchangeをonTraverseへ渡す。
function createHashStore(onTraverse: () => void) {
  const listeners = new Set<() => void>();
  let snapshot: Snapshot = SERVER_SNAPSHOT;
  return {
    current: () => snapshot,
    // 自分の書き込みと、ブラウザの移動を購読者へ知らせる。
    notify(closeFocus: SettingsCloseFocus) {
      snapshot = { hash: window.location.hash, closeFocus };
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      if (listeners.size === 0) {
        window.addEventListener("popstate", onTraverse);
        window.addEventListener("hashchange", onTraverse);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        window.removeEventListener("popstate", onTraverse);
        window.removeEventListener("hashchange", onTraverse);
      };
    },
    getSnapshot(): Snapshot {
      if (snapshot.hash !== window.location.hash)
        snapshot = { hash: window.location.hash, closeFocus: "opener" };
      return snapshot;
    },
  };
}

// ハッシュと履歴の読み書き。
// pushState・replaceStateには自分の値だけを持つ新しいオブジェクトを渡す(Next.jsは今の状態の内部の印を写して取り込む)。
function createSettingsHistory() {
  const store = createHashStore(onTraverse);
  // 閉じるための戻り(history.go)が、起点に着くのを待っている間は真。
  let closing = false;

  // 起点でハッシュを外して閉じる。フォーカスは背景の画面の先頭へ戻す。
  function removeHash() {
    window.history.replaceState({}, "", urlWithHash(""));
    store.notify("content");
  }

  // ブラウザの戻る・進む、アドレス欄でのハッシュの書き換え、閉じるための戻りの到着。
  // 1回の移動でpopstateとhashchangeの両方が届くため、ハッシュが変わらない2回目は無視する。
  function onTraverse() {
    if (closing) {
      closing = false;
      if (settingsLocationOf(window.location.hash).view !== null) {
        removeHash();
        return;
      }
    }
    if (window.location.hash === store.current().hash) return;
    store.notify("opener");
  }

  // 今の段数に1を足した項目を積む。今と同じハッシュへは積まない。
  function push(hash: string) {
    if (closing || window.location.hash === hash) return;
    const id = currentDocumentId();
    const depth = settingsDepthOf(window.history.state, id) + 1;
    const state = settingsHistoryStateOf(depth, id);
    window.history.pushState(state, "", urlWithHash(hash));
    store.notify("opener");
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    open: () => push(SETTINGS_ACCOUNT_HASH),
    move: (view: SettingsView) => push(settingsHashOf(view)),
    // 履歴を増やさずに、ハッシュを書き換える。今の項目の段数は保つ。
    normalize(hash: string) {
      const id = currentDocumentId();
      const depth = settingsDepthOf(window.history.state, id);
      const state = depth > 0 ? settingsHistoryStateOf(depth, id) : {};
      window.history.replaceState(state, "", urlWithHash(hash));
      store.notify(store.current().closeFocus);
    },
    // 今の段数だけ戻って起点へ着き、起点のハッシュが設定のハッシュなら外す(着いたときのpopstateで行う)。段数が0なら戻らずに外す。
    close() {
      if (closing) return;
      const depth = settingsDepthOf(window.history.state, currentDocumentId());
      if (depth === 0) return removeHash();
      closing = true;
      window.history.go(-depth);
    },
  };
}

// 設定パネルの開閉と表示を、URLのハッシュと履歴から決める。`(main)`のレイアウトが1つ呼ぶ。
export function useSettingsRoute(): SettingsRoute {
  const [history] = useState(createSettingsHistory);
  const snapshot = useSyncExternalStore(
    history.subscribe,
    history.getSnapshot,
    () => SERVER_SNAPSHOT,
  );
  const location = settingsLocationOf(snapshot.hash);

  // `#settings`と存在しない分類・項目は、分類「アカウント」のハッシュへ書き換える。
  useEffect(() => {
    if (location.normalize) history.normalize(SETTINGS_ACCOUNT_HASH);
  }, [history, location.normalize]);

  return {
    view: location.view,
    closeFocus: snapshot.closeFocus,
    open: history.open,
    move: history.move,
    close: history.close,
  };
}
