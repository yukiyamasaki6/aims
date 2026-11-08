import type { LinkClick, LinkClicks } from "../application/update-activation";

// 修飾なしで、別の経路へ移るリンク操作のときだけ、そのアンカーを返す。アプリのリンクは全て内部のパスで、外部・target・downloadのリンクは無い。
function findNavigatingAnchor(
  event: MouseEvent,
): HTMLAnchorElement | undefined {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return undefined;
  }
  const anchor =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[href]")
      : null;
  if (!anchor) return undefined;
  const url = new URL(anchor.href, location.href);
  if (url.pathname === location.pathname && url.search === location.search) {
    return undefined;
  }
  return anchor;
}

// documentのcapture段階のclickを購読する。除外した操作はnullで届ける。
export function createBrowserLinkClicks(): LinkClicks {
  return {
    onClick(listener) {
      // 押し直しの間だけtrue。自分の購読を無効にして、止めずに通す。
      let repeating = false;
      const handle = (event: MouseEvent) => {
        if (repeating) return;
        const anchor = findNavigatingAnchor(event);
        if (!anchor) {
          listener(null);
          return;
        }
        const link: LinkClick = {
          block: () => {
            event.preventDefault();
            event.stopPropagation();
          },
          follow: () => location.assign(anchor.href),
          repeat: () => {
            repeating = true;
            anchor.click();
            repeating = false;
          },
        };
        listener(link);
      };
      document.addEventListener("click", handle, true);
      return () => document.removeEventListener("click", handle, true);
    },
  };
}
