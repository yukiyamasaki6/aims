"use client";

import { useEffect } from "react";

// 再要求の最大回数と間隔。
const MAX_REQUESTS = 3;
const RETRY_MS = 1_000;

// 更新時に旧SWの停止と制御下のページのfetchが重なると、新SWがskipWaitingを
// 呼んでいてもwaitingのまま残ることがある（旧SWのアイドル停止、最大約30秒まで）。
// waitingの新SWを検知し、SKIP_WAITINGメッセージで有効化を再要求する。
// 有効化の挙動（clientsClaimで即座に制御を移す）自体はsw.tsの構成のままで、
// 表示は何も行わない。
export function SwUpdateActivator() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    // waitingが残っている間、間隔を空けて最大回数まで再要求する。
    const activate = (registration: ServiceWorkerRegistration, count = 0) => {
      if (disposed || !registration.waiting || count >= MAX_REQUESTS) return;
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      clearTimeout(timer);
      timer = setTimeout(() => activate(registration, count + 1), RETRY_MS);
    };

    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (disposed || !registration) return;

      const onUpdateFound = () => {
        const installing = registration.installing;
        if (!installing) return;
        const onStateChange = () => {
          if (installing.state === "installed") activate(registration);
        };
        installing.addEventListener("statechange", onStateChange);
      };

      registration.addEventListener("updatefound", onUpdateFound);
      cleanup = () =>
        registration.removeEventListener("updatefound", onUpdateFound);
      // 既にwaitingのまま残っているページ読み込み時にも要求する。
      activate(registration);
    });

    return () => {
      disposed = true;
      clearTimeout(timer);
      cleanup?.();
    };
  }, []);

  return null;
}
