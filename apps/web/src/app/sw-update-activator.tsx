"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { FALLBACK_WAIT_MS } from "@/features/fetch-result/fetch-content";
import { roundOpHub } from "@/features/rounds/round-op-hub";

type SwitchHandlers = {
  onSwitched: () => void;
  onGiveUp: () => void;
};

// 待機中のSWを有効にしてから、遷移先の文書を取得させる。リンクの操作を止めている間の処理で、クリックから1つの期限(FALLBACK_WAIT_MS)を共有する。
// 順序は、保存の完了待ち、SKIP_WAITINGの送信(1回)、controllerchangeの待ち、文書を読み直す直前の保存の再確認。
// 保存の途中の操作を失わないため、文書を読み直す経路だけで保存を待つ。保存が終わらないときは、有効にせずに諦める。
// 期限までに終わらないときは`onGiveUp`、済めば`onSwitched`を呼ぶ。返す関数で、購読とタイマーを外して中止する(どちらも呼ばない)。
function switchToWaiting(
  registration: ServiceWorkerRegistration,
  { onSwitched, onGiveUp }: SwitchHandlers,
): () => void {
  const container = navigator.serviceWorker;
  let cancelled = false;
  let onChange: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), FALLBACK_WAIT_MS);
  });
  const persisted = () =>
    Promise.race([roundOpHub.whenPersisted().then(() => true), deadline]);

  const cleanup = () => {
    clearTimeout(timer);
    if (onChange) container.removeEventListener("controllerchange", onChange);
  };

  const run = async () => {
    if (!(await persisted())) return false;
    const changed = new Promise<true>((resolve) => {
      onChange = () => resolve(true);
      container.addEventListener("controllerchange", onChange);
    });
    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    if (!(await Promise.race([changed, deadline]))) return false;
    return persisted();
  };

  void run().then((switched) => {
    cleanup();
    if (cancelled) return;
    if (switched) onSwitched();
    else onGiveUp();
  });

  return () => {
    cancelled = true;
    cleanup();
  };
}

// 内部へ移る、修飾なしの通常のリンク操作のときだけ、そのアンカーを返す。
function findNavigatingAnchor(
  event: MouseEvent,
): HTMLAnchorElement | undefined {
  if (event.defaultPrevented || event.button !== 0) return undefined;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return undefined;
  }
  const anchor =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[href]")
      : null;
  if (!anchor || anchor.hasAttribute("download")) return undefined;
  if (anchor.target && anchor.target !== "_self") return undefined;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin) return undefined;
  if (url.pathname === location.pathname && url.search === location.search) {
    return undefined;
  }
  return anchor;
}

type ActivatorState = {
  mounted: boolean;
  loaded: boolean;
  registration: ServiceWorkerRegistration | undefined;
  // 進行中の切り替えの中止。
  cancel: (() => void) | undefined;
  // 切り替えを諦めて通した遷移と、保持の前に通した遷移でtrue。遷移後の更新の確認を抑え、パスの変化で消す。
  attempted: boolean;
  // 諦めた後にアンカーを押し直しているときだけtrue。止めずに通す。
  reinjecting: boolean;
};

// 登録を未保持なら取得して保持する。保持だけを行い、切り替えも更新もしない。
function holdRegistration(state: ActivatorState) {
  if (!("serviceWorker" in navigator) || state.registration) return;
  void navigator.serviceWorker.getRegistration().then((registration) => {
    if (state.mounted && registration) state.registration = registration;
  });
}

// 切り替えを諦めたとき、同じアンカーを押し直して通常の遷移を進める(旧SWが旧ビルドの枠を返す)。
function giveUp(state: ActivatorState, anchor: HTMLAnchorElement) {
  state.cancel = undefined;
  state.attempted = true;
  state.reinjecting = true;
  anchor.click();
  state.reinjecting = false;
}

// capture段階のclickで、待機中のSWがあれば遷移を止めて、切り替えてから文書を取得させる。
function handleClick(state: ActivatorState, event: MouseEvent) {
  if (state.reinjecting) return;
  state.attempted = false;
  const anchor = findNavigatingAnchor(event);
  if (!anchor || !("serviceWorker" in navigator)) return;
  const { registration } = state;
  if (!registration) {
    state.attempted = true;
    return;
  }
  if (!registration.waiting && !state.cancel) return;
  event.preventDefault();
  event.stopPropagation();
  if (state.cancel) return;
  state.cancel = switchToWaiting(registration, {
    onSwitched: () => {
      state.cancel = undefined;
      location.assign(anchor.href);
    },
    onGiveUp: () => giveUp(state, anchor),
  });
}

// パスの変化のあと、待機が無い遷移で更新を確認する。通した遷移(attempted)では確認しない。
function checkUpdateAfterNavigation(state: ActivatorState) {
  const navigated = state.loaded;
  state.loaded = true;
  holdRegistration(state);
  if (state.attempted) {
    state.attempted = false;
    return;
  }
  const { registration } = state;
  if (navigated && registration && !registration.waiting) {
    registration.update().catch(() => {});
  }
}

// 待機中のSWを、内部リンクの操作の前に有効にしてから遷移させ、遷移先を最初から新しいビルドで表示する。
// 遷移の文書取得を旧SWが返すと旧ビルドの枠が出るため、取得の前に切り替える。待機の判定は、保持した登録のwaitingの同期の読み取りだけで行う。
// 待機が無い遷移では更新を確認し、見つかった版は次のリンク操作で切り替える。
// 保持の前の操作、切り替えの失敗、リンク以外の経路(router.push、戻る・進む)では切り替えず、その遷移では更新も試みない。次の遷移で通常どおり判定する。
export function SwUpdateActivator() {
  const pathname = usePathname();
  const stateRef = useRef<ActivatorState>({
    mounted: false,
    loaded: false,
    registration: undefined,
    cancel: undefined,
    attempted: false,
    reinjecting: false,
  });

  useEffect(() => {
    const state = stateRef.current;
    state.mounted = true;
    holdRegistration(state);
    const onClick = (event: MouseEvent) => handleClick(state, event);
    document.addEventListener("click", onClick, true);
    return () => {
      state.mounted = false;
      document.removeEventListener("click", onClick, true);
      state.cancel?.();
      state.cancel = undefined;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: パスの変化(画面の遷移)を契機に実行するため、本体で読まないpathnameを依存にする
  useEffect(() => {
    checkUpdateAfterNavigation(stateRef.current);
  }, [pathname]);

  return null;
}
