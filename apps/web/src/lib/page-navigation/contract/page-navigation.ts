// 画面の遷移(ルーターで進む)。go: 履歴を積んで進む。replace: 置き換える。
// 例外: 投げることがある(画面のパッケージが経路を受け付けないとき)。扱いは使う手続きが宣言する。
export type PageNavigation = {
  go(path: string): void;
  replace(path: string): void;
};
