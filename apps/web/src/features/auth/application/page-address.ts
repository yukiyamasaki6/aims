// 今のURLの読み出しと書き換え。例外は投げない。
export type PageAddress = {
  // 今のURLのクエリ(`location.search`の形。無いときは空文字)。
  search(): string;
  // 今のパスのクエリを置き換え、ハッシュを外す。履歴を増やさず、読み込まない。searchは先頭の`?`つき(無ければ空文字)。
  rewrite(search: string): void;
};
