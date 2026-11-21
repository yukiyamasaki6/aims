import type { AccountSummaryStore } from "./account-summary-store";
import type { SignInChanges } from "./auth-changes";

// 端末の識別情報の書き込み。nullは消す。保存先が使えない環境は想定しない。
export type IdentityWriter = {
  write(userId: string | null): void;
};

type Dependencies = {
  changes: SignInChanges;
  writer: IdentityWriter;
  summaries: Pick<AccountSummaryStore, "write" | "clear">;
};

export type LocalIdentity = {
  // 認証状態の変化に追従して、端末の識別情報とアカウントの概要を記録する。解除する関数を返す。
  start(): () => void;
};

export function createLocalIdentity({
  changes,
  writer,
  summaries,
}: Dependencies): LocalIdentity {
  return {
    start: () =>
      changes.subscribe((change) => {
        // サインインした利用者を記録し、サインアウトで消す。
        // 記録しない出来事(利用者のいない起動時、トークンの更新など)は通知されない。
        // 概要は、読めた通知(summaryがnullでない)だけで書き換え、サインアウトで消す。
        if (change.kind === "signed-out") {
          writer.write(null);
          summaries.clear();
          return;
        }
        // 識別情報を先に書く(概要の読み出しは、識別情報の利用者との一致を確かめるため)。
        writer.write(change.userId);
        if (change.summary !== null) summaries.write(change.summary);
      }),
  };
}
