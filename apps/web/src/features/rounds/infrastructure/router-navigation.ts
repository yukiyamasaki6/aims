import type { Navigation } from "../application/start-round";

// 画面のパッケージの遷移の部品のうち、使う操作だけ。起動地点が渡す。
export type PageRouter = { push(href: string): void };

// pushの例外は変換せずにそのまま出す(約束の宣言のとおり)。
export function createRouterNavigation(router: PageRouter): Navigation {
  return { go: (path) => router.push(path) };
}
