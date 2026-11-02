// 通信の可否の読み出しと、通信が戻ったこと、切れたことの通知。
// 例外: どれも投げない。
export type Connectivity = {
  isOffline(): boolean;
  // 通信が戻ったら呼ぶ。購読を解除する関数を返す。
  onOnline(listener: () => void): () => void;
  // 通信が切れたら呼ぶ。購読を解除する関数を返す。
  onOffline(listener: () => void): () => void;
};
