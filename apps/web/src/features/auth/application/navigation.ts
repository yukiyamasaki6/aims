// 画面の遷移と、今の画面の遷移元の読み出し。どちらも投げることがあり、手続きが失敗として扱う。
export type Navigation = {
  returnTo(): string | null;
  go(path: string): void;
};
