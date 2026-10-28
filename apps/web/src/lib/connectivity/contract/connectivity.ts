// 通信の可否の読み出しと、通信が戻ったことの通知。
// 例外: どちらも投げない。
export type Connectivity = {
  isOffline(): boolean;
  // 通信が戻ったら呼ぶ。購読を解除する関数を返す。
  onOnline(listener: () => void): () => void;
};
