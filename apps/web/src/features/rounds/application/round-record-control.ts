import { matchRecordUser } from "../domain/record-user";
import type { OpSender } from "./op-sender";
import type { RoundRecordHub } from "./round-record-hub";

// 他の機能へ公開する、記録の制御。起動、停止、利用者、送信の制御。引数と戻り値は、利用者のIDの文字列、結果の種類の文字列だけで、ドメインの型は越えない。
export type RoundRecordControl = {
  // 記録を起動し、その後に送信を始める。
  start(userId: string | null): void;
  // 送信を止め、その後に記録を止める。
  stop(): void;
  // 送信の状態を捨て、その後に記録の利用者を替える。
  setUser(userId: string | null): void;
  matchUser(userId: string | null): "same" | "other" | "unowned";
  // 保留した送信を戻して送る。サインインし直したときに使う。
  resumeSending(): void;
  // 通信の回復で、リトライ待機の送信をすぐに再送する。
  recoverOnline(): void;
};

export function createRoundRecordControl(deps: {
  hub: Pick<RoundRecordHub, "start" | "stop" | "setUser" | "userId">;
  sender: OpSender;
}): RoundRecordControl {
  const { hub, sender } = deps;
  return {
    start(userId) {
      hub.start(userId);
      sender.start();
    },
    stop() {
      sender.stop();
      hub.stop();
    },
    setUser(userId) {
      sender.reset();
      hub.setUser(userId);
    },
    matchUser: (userId) => matchRecordUser(hub.userId(), userId),
    resumeSending: () => sender.resumeHeld(),
    recoverOnline: () => sender.online(),
  };
}
