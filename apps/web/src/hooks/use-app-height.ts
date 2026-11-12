import { useEffect } from "react";

const APP_HEIGHT_VARIABLE = "--app-height";
// 値の差がこれ未満なら書かない。
const MIN_CHANGE_PX = 0.5;
// 通知なしに変わる値を拾い直す時刻(マウントからのミリ秒)。
const RECHECK_DELAYS_MS = [500, 2000];

// ソフトキーボードで縮むレイアウトビューポート(interactiveWidget)に対応する環境の代用の判定。
// iOS Safariは非対応で、可視の高さを書くとキーボードでの縮み方が変わる恐れがあるため、書かない。
function supportsCompensation(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches &&
    "virtualKeyboard" in navigator
  );
}

function visibleHeight(): number {
  const viewport = window.visualViewport;
  return viewport ? viewport.height * viewport.scale : window.innerHeight;
}

// スタンドアロンでは、起動時に100dvhが可視の高さからずれることがある。
// 根の枠(body)の高さの変数を、実測した可視の高さに差し替え、画面を枠に従わせる。
// ブラウザのタブでは何もせず、変数は既定の100dvhのままにする。
export function useAppHeight(): void {
  useEffect(() => {
    if (!supportsCompensation()) return;

    const root = document.documentElement.style;
    let written: number | undefined;
    const update = () => {
      const height = visibleHeight();
      if (written !== undefined && Math.abs(height - written) < MIN_CHANGE_PX) {
        return;
      }
      written = height;
      root.setProperty(APP_HEIGHT_VARIABLE, `${height}px`);
    };

    update();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    window.addEventListener("pageshow", update);
    window.addEventListener("orientationchange", update);
    document.addEventListener("visibilitychange", update);
    const timers = RECHECK_DELAYS_MS.map((delay) =>
      window.setTimeout(update, delay),
    );

    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("pageshow", update);
      window.removeEventListener("orientationchange", update);
      document.removeEventListener("visibilitychange", update);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);
}
