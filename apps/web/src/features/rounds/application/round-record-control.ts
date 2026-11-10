import type { SignInChange } from "@/features/auth";
import { matchRecordUser } from "../domain/record-user";
import type { OpSender } from "./op-sender";
import type { RoundRecordHub } from "./round-record-hub";

// 他の機能へ公開する、記録の制御。起動、サインインの変化への反応、利用者の照合。引数と戻り値は、利用者のIDの文字列、サインインの変化(認証の入口の公開の型)、結果の種類の文字列だけで、ドメインの型は越えない。
export type RoundRecordControl = {
  // 記録を起動し、その後に送信を始める。
  start(userId: string | null): void;
  isRecordUser(userId: string | null): boolean;
  // サインインの変化に反応する。利用者のいる変化では、保留した送信を戻す(別の利用者の送信は送信器が保留したままにする)。サインアウトでは何もしない(利用者の切り替えは、見張りがページ全体を読み込み直して行う)。
  signInChanged(change: SignInChange): void;
};

export function createRoundRecordControl(deps: {
  hub: Pick<RoundRecordHub, "start" | "userId">;
  sender: OpSender;
}): RoundRecordControl {
  const { hub, sender } = deps;
  return {
    start(userId) {
      hub.start(userId);
      sender.start();
    },
    isRecordUser: (userId) => matchRecordUser(hub.userId(), userId) === "same",
    signInChanged(change) {
      if (change.kind === "signed-in") sender.resumeHeld();
    },
  };
}
