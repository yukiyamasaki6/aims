import type { PageNavigation } from "../contract/page-navigation";

// 画面のパッケージの遷移の部品のうち、使う操作だけ。起動地点と画面の入口が渡す。
export type PageRouter = {
  push(href: string): void;
  replace(href: string): void;
};

// push、replaceの例外は変換せずにそのまま出す(約束の宣言のとおり)。
export function createRouterPageNavigation(router: PageRouter): PageNavigation {
  return {
    go: (path) => router.push(path),
    replace: (path) => router.replace(path),
  };
}
