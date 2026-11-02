import type { SenderLock, SenderMessage } from "../application/op-sender";

const LOCK_NAME = "aims-sync-sender";
const CHANNEL_NAME = "aims-sync-sender";

// 送る役の選出(Web Locks)と、保留の状態と送信の依頼の知らせ(BroadcastChannel)。
// Web Locksが無いブラウザでは、単独の送り手として動く(複数タブの間の順序は保証しない)。
export function createBrowserSenderLock(): SenderLock {
  let channel: BroadcastChannel | undefined;
  return {
    request(onElected) {
      const locks =
        typeof navigator === "undefined" ? undefined : navigator.locks;
      if (!locks) {
        void onElected();
        return () => {};
      }
      const abort = new AbortController();
      let release: (() => void) | undefined;
      locks
        .request(LOCK_NAME, { signal: abort.signal }, async () => {
          // 読み込み中の停止でも解放できるよう、読み込みの前に解放の手段を設定する。
          const released = new Promise<void>((resolve) => {
            release = resolve;
          });
          await onElected();
          // 停止まで保持する。タブを閉じると自動で解放される。
          await released;
        })
        .catch(() => {});
      return () => {
        abort.abort();
        release?.();
      };
    },
    open(listener) {
      if (typeof BroadcastChannel === "undefined") return () => {};
      const opened = new BroadcastChannel(CHANNEL_NAME);
      channel = opened;
      opened.addEventListener("message", (event: MessageEvent<SenderMessage>) =>
        listener(event.data),
      );
      return () => {
        opened.close();
        if (channel === opened) channel = undefined;
      };
    },
    post(message) {
      try {
        channel?.postMessage(message);
      } catch {
        // 閉じたチャネルへの送信は何もしない。
      }
    },
  };
}
