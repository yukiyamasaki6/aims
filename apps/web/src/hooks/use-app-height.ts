import { useEffect } from "react";

const APP_HEIGHT_VARIABLE = "--app-height";
// 値の差がこれ未満なら書かない。
const MIN_CHANGE_PX = 0.5;

// ソフトキーボードで縮まないレイアウトビューポート(interactiveWidget: resizes-visual)に対応する環境の代用の判定。
// iOS Safariは非対応で、高さを書くとキーボードでの縮み方が変わる恐れがあるため、書かない。
function supportsCompensation(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches &&
    "virtualKeyboard" in navigator
  );
}

// スタンドアロンでは、起動時に100dvhが可視の高さからずれることがある。
// 根の枠(body)の高さの変数を、キーボードで縮まないレイアウトビューポートの高さ(innerHeight)に差し替え、画面を枠に従わせる。
// ブラウザのタブでは何もせず、変数は既定の100dvhのままにする。
export function useAppHeight(): void {
  useEffect(() => {
    if (!supportsCompensation()) return;

    const root = document.documentElement.style;
    let written: number | undefined;
    const update = () => {
      const height = window.innerHeight;
      if (written !== undefined && Math.abs(height - written) < MIN_CHANGE_PX) {
        return;
      }
      written = height;
      root.setProperty(APP_HEIGHT_VARIABLE, `${height}px`);
    };

    update();
    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
    };
  }, []);
}
