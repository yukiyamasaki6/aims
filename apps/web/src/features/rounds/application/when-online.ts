import type { Connectivity } from "@/lib/connectivity/contract/connectivity";

// 今オンラインなら直ちに、オフラインなら次に通信が戻ったときに、1回だけlistenerを呼ぶ。返す関数で取り消す。
// 表示の読み直しの合図で、取得と反映の時点は決めない。
export type WhenOnline = (listener: () => void) => () => void;

export function whenOnline(
  connectivity: Connectivity,
  listener: () => void,
): () => void {
  if (!connectivity.isOffline()) {
    listener();
    return () => {};
  }
  let stop: (() => void) | undefined = connectivity.onOnline(() => {
    stop?.();
    stop = undefined;
    listener();
  });
  return () => {
    stop?.();
    stop = undefined;
  };
}
