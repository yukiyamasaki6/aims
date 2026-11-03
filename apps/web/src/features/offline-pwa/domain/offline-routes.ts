// オフラインとプリキャッシュの経路。経路の文字列の持ち主は、ここと、ラウンドの経路(rounds/domain/round-routes.ts)である。
// next.config.tsとserwist.config.mjsが直接読み込むため、importを持たず、型注釈以外の構文(enum等)は使わない。

// オフライン時に返す、認証に依存しない静的なページ。
export const OFFLINE_PATH = "/offline";

// プリキャッシュの枠のURL。proxy.tsのmatcher外の/__shell/*で配り、未認証での登録でも/signinのHTMLを保存しない。
export const SHELL_PREFIX = "/__shell";

// 枠の経路に対応する、配布用のURL。
export function shellUrlOf(framePath: string): string {
  return `${SHELL_PREFIX}${framePath}`;
}

// 枠の経路に対応する、ビルド成果物(.next/server/app配下)のHTMLの名前。
export function frameHtmlOf(framePath: string): string {
  return `${framePath.slice(1)}.html`;
}

// 枠の配布用のURLか。
export function isShellUrl(pathname: string): boolean {
  return pathname.startsWith(`${SHELL_PREFIX}/`);
}

// ナビゲーションのpathnameに対応する枠の配布用URL。枠のないパスはnull。
// frameOfは、経路に対応する枠の経路(無ければnull)を返す。枠を決める規則は他の機能が持つため、入口が渡す。
export function frameUrlFor(
  pathname: string,
  frameOf: (pathname: string) => string | null,
): string | null {
  const framePath = frameOf(pathname);
  return framePath === null ? null : shellUrlOf(framePath);
}
