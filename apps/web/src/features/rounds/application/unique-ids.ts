// 新しいID(操作のイベントID、ラウンドと距離のID)と、IDに混ぜる乱数の払い出し。例外: 投げない。
export type UniqueIds = {
  next(): string;
  randomBytes(length: number): Uint8Array;
};
