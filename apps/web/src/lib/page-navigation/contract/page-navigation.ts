// 画面の遷移(ルーターで進む)。go: 履歴を積んで進む。replace: 置き換える。
// 例外: 投げない。
export type PageNavigation = {
  go(path: string): void;
  replace(path: string): void;
};
