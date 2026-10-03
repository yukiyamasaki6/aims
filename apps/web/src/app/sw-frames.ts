// Service Workerがプリキャッシュから返す画面の枠。sw.tsとserwist.config.mjsが同じ定義を使う。
// serwist.config.mjsからNodeの型除去で直接読み込むため、型注釈以外の構文（enum等）は使わない。

// プリキャッシュのURL。proxy.tsのmatcher外の/__shell/*で配り、未認証での登録でも/signinのHTMLを保存しない。
export const SHELL_PREFIX = "/__shell";

// 枠のプリキャッシュ対象。htmlは.next/server/app配下のビルド成果物。
export const FRAME_ENTRIES: { url: string; html: string }[] = [
  { url: `${SHELL_PREFIX}/rounds`, html: "rounds.html" },
  { url: `${SHELL_PREFIX}/rounds/new`, html: "rounds/new.html" },
  { url: `${SHELL_PREFIX}/rounds/_`, html: "rounds/_.html" },
];

// ナビゲーションのpathnameに対応する枠のURL。枠のないパスはnull。
// 末尾スラッシュ付きや/rounds/<id>/xは一致させず、従来どおりネットワークに任せる。
export function frameUrlFor(pathname: string): string | null {
  if (pathname === "/rounds") return `${SHELL_PREFIX}/rounds`;
  if (pathname === "/rounds/new") return `${SHELL_PREFIX}/rounds/new`;
  if (/^\/rounds\/[^/]+$/.test(pathname)) return `${SHELL_PREFIX}/rounds/_`;
  return null;
}
