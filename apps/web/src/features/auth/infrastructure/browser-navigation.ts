import type { Navigation } from "../application/navigation";
import { readReturnTo } from "../domain/return-to";

// routerは画面のパッケージの遷移の部品で、入口が渡す。
export function createBrowserNavigation(router: {
  push(href: string): void;
}): Navigation {
  return {
    returnTo: () => readReturnTo(window.location.search),
    go: (path) => router.push(path),
  };
}
