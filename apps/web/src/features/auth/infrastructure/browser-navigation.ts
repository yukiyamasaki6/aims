import type { Navigation } from "../application/navigation";
import { RETURN_TO_PARAM } from "../domain/routes";

// routerは画面のパッケージの遷移の部品で、入口が渡す。
export function createBrowserNavigation(router: {
  push(href: string): void;
}): Navigation {
  return {
    returnTo: () =>
      new URLSearchParams(window.location.search).get(RETURN_TO_PARAM),
    go: (path) => router.push(path),
  };
}
