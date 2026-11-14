// 表示領域の診断を表示するかどうかの設定。ブラウザの保存先に当たる境界で、試験では偽物に替える。
export type DiagnosticsSetting = {
  read: () => boolean;
  write: (enabled: boolean) => void;
  // 値が変わったときに呼ぶ関数を登録し、解除する関数を返す。
  subscribe: (listener: () => void) => () => void;
};
