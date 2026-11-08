import type { SignInChanges } from "./auth-changes";

// 端末の識別情報の書き込み。nullは消す。書けないとき(保存先が使えない環境)は何もしない。例外は投げない。
export type IdentityWriter = {
  write(userId: string | null): void;
};

type Dependencies = {
  changes: SignInChanges;
  writer: IdentityWriter;
};

export type LocalIdentity = {
  // 認証状態の変化に追従して、端末の識別情報を記録する。解除する関数を返す。
  start(): () => void;
};

export function createLocalIdentity({
  changes,
  writer,
}: Dependencies): LocalIdentity {
  return {
    start: () =>
      changes.subscribe((change) => {
        // サインインした利用者を記録し、サインアウトで消す。
        // 記録しない出来事(利用者のいない起動時、トークンの更新など)は通知されない。
        writer.write(change.kind === "signed-in" ? change.userId : null);
      }),
  };
}
