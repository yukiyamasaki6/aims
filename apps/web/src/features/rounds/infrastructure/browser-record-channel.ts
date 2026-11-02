import type {
  RecordChannel,
  RecordMessage,
} from "../application/round-record-hub";

const CHANNEL_NAME = "aims-sync";

// 記録の変化を他のタブへ知らせる。BroadcastChannelが無いブラウザでは何もしない。
export function createBrowserRecordChannel(): RecordChannel {
  let channel: BroadcastChannel | undefined;
  return {
    open(listener) {
      if (typeof BroadcastChannel === "undefined") return () => {};
      const opened = new BroadcastChannel(CHANNEL_NAME);
      channel = opened;
      opened.addEventListener("message", (event: MessageEvent<RecordMessage>) =>
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
