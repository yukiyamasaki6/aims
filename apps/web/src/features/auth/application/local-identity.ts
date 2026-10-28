import { identityChange } from "../domain/session-event";
import type { AuthEvents } from "./auth-events";

// 端末の識別情報の書き込み。nullは消す。書けないとき(保存先が使えない環境)は何もしない。例外は投げない。
export type IdentityWriter = {
  write(userId: string | null): void;
};

type Dependencies = {
  events: AuthEvents;
  writer: IdentityWriter;
};

export type LocalIdentity = {
  // 認証状態の変化に追従して、端末の識別情報を記録する。解除する関数を返す。
  start(): () => void;
};

export function createLocalIdentity({
  events,
  writer,
}: Dependencies): LocalIdentity {
  return {
    start: () =>
      events.subscribe((event) => {
        const change = identityChange(event);
        if (change.kind === "record") writer.write(change.userId);
        else if (change.kind === "clear") writer.write(null);
      }),
  };
}
