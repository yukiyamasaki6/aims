import type { SignInChange } from "@/features/auth";
import { matchRecordUser, reactionToSignIn } from "../domain/record-user";
import type { OpSender } from "./op-sender";
import type { RoundRecordHub } from "./round-record-hub";

// 他の機能へ公開する、記録の制御。起動、停止、サインインの変化への反応、利用者の照合。引数と戻り値は、利用者のIDの文字列、サインインの変化(認証の入口の公開の型)、結果の種類の文字列だけで、ドメインの型は越えない。
export type RoundRecordControl = {
  // 記録を起動し、その後に送信を始める。
  start(userId: string | null): void;
  // 送信を止め、その後に記録を止める。
  stop(): void;
  matchUser(userId: string | null): "same" | "other" | "unowned";
  // サインインの変化に反応する。同じ利用者なら、保留した送信を戻して送る。別の利用者か、記録の利用者がnullなら、送信の状態を捨てて、記録の利用者を替える。サインアウトは利用者を無くす。
  signInChanged(change: SignInChange): void;
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
    matchUser: (userId) => matchRecordUser(hub.userId(), userId),
    signInChanged(change) {
      const reaction = reactionToSignIn(
        change.kind === "signed-out" ? null : change.userId,
        hub.userId(),
      );
      if (reaction.type === "switch-user") {
        sender.reset();
        hub.setUser(reaction.userId);
      } else {
        sender.resumeHeld();
      }
    },
  };
}
