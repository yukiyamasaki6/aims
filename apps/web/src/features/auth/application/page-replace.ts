// ページ全体を読み込んで、今の場所を置き換える遷移。履歴を残さず、前の利用者の画面の状態とクライアントのキャッシュを捨てる。
// 例外: 投げない。
export type PageReplace = {
  // 今の場所(パスとクエリ)。
  here(): string;
  replace(path: string): void;
};
