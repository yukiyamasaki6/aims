"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { roundOpHub } from "@/app/(main)/rounds/_shared/round-op-hub";
import { FALLBACK_WAIT_MS } from "@/features/fetch-result/fetch-content";

// SKIP_WAITINGの最大送信回数と間隔。
const MAX_REQUESTS = 3;
const RETRY_MS = 1_000;

// 端末の保存の完了を待って読み込み直す。保存の途中の操作を失わないため。
// 保存が上限(FALLBACK_WAIT_MS)までに終わらないときは読み込み直さず、`onGiveUp`を呼ぶ。
// 返す関数で、待ちとタイマーを中止する。
function reloadWhenPersisted(onGiveUp: () => void): () => void {
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    onGiveUp();
  }, FALLBACK_WAIT_MS);
  void roundOpHub.whenPersisted().then(() => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    location.reload();
  });
  return () => {
    done = true;
    clearTimeout(timer);
  };
}

// 待機中のSWへSKIP_WAITINGを送り、controllerchangeの後、端末の保存の完了を待って読み込み直す。
// 旧SWの停止と画面のfetchが重なると有効化が進まずwaitingに残ることがあるため、controllerchangeが来ない間は間隔を空けて最大回数まで送り直す。
// controllerchangeが来ないときは、読み込み直さず、待機が残るので次の遷移で再び試みる。
// controllerchangeの後に保存が上限までに終わらないときは、新SWが旧文書を制御し待機は空になるため、`onSettled(true)`で伝え、次の遷移で読み込み直させる。
// 返す関数で、購読とタイマーを外して中止する。終了時には`onSettled`を呼ぶ。
function switchToWaiting(
  registration: ServiceWorkerRegistration,
  onSettled: (reloadPending: boolean) => void,
): () => void {
  const container = navigator.serviceWorker;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelReload: (() => void) | undefined;
  let settled = false;
  let count = 0;

  const stop = () => {
    settled = true;
    clearTimeout(timer);
    cancelReload?.();
    container.removeEventListener("controllerchange", onControllerChange);
  };

  const settle = (reloadPending: boolean) => {
    if (settled) return;
    stop();
    onSettled(reloadPending);
  };

  const request = () => {
    if (count >= MAX_REQUESTS) {
      settle(false);
      return;
    }
    count += 1;
    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    timer = setTimeout(request, RETRY_MS);
  };

  function onControllerChange() {
    container.removeEventListener("controllerchange", onControllerChange);
    clearTimeout(timer);
    cancelReload = reloadWhenPersisted(() => settle(true));
  }

  container.addEventListener("controllerchange", onControllerChange);
  request();
  return stop;
}

// 待機中のSWを、画面の遷移の瞬間(読み込みとクライアント側の遷移)に有効にして、遷移先を新しいビルドで読み込み直す。
// 待機が無いクライアント側の遷移では更新を確認し、見つかった版は次の遷移で切り替える。表示は何も行わない。
export function SwUpdateActivator() {
  const pathname = usePathname();
  const loaded = useRef(false);
  const mounted = useRef(false);
  const cancel = useRef<(() => void) | undefined>(undefined);
  // 切り替えの後に読み込み直せず、新SWが旧文書を制御している間はtrue。次の遷移で読み込み直す。
  const reloadPending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel.current?.();
      cancel.current = undefined;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: パスの変化(画面の遷移)を契機に実行するため、本体で読まないpathnameを依存にする
  useEffect(() => {
    const navigated = loaded.current;
    loaded.current = true;
    if (!("serviceWorker" in navigator) || cancel.current) return;
    if (reloadPending.current) {
      cancel.current = reloadWhenPersisted(() => {
        cancel.current = undefined;
      });
      return;
    }

    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration || !mounted.current || cancel.current) return;
      if (registration.waiting) {
        cancel.current = switchToWaiting(registration, (pending) => {
          cancel.current = undefined;
          reloadPending.current = pending;
        });
      } else if (navigated) {
        registration.update().catch(() => {});
      }
    });
  }, [pathname]);

  return null;
}
