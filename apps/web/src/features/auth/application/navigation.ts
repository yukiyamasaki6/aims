// 画面の遷移(ルーターで進む)と、今の画面の遷移元の読み出し。
// 例外: どちらも投げることがあり、手続きが通信エラーの失敗として扱う。
export type Navigation = {
  returnTo(): string | null;
  go(path: string): void;
};
