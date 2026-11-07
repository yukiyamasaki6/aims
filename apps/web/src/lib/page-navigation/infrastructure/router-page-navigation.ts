import type { PageNavigation } from "../contract/page-navigation";

// 画面のパッケージの遷移の部品のうち、使う操作だけ。起動地点と画面の入口が渡す。
export type PageRouter = {
  push(href: string): void;
  replace(href: string): void;
};

export function createRouterPageNavigation(router: PageRouter): PageNavigation {
  return {
    go: (path) => router.push(path),
    replace: (path) => router.replace(path),
  };
}
