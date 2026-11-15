import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import {
  beginDeleteAccount,
  type DeleteAccountEvent,
  type DeleteAccountFlow,
  type Reauthentication,
} from "../domain/delete-account-flow";
import type { ScreenView } from "./screen-view";
import type { SessionEndHold, SessionReader } from "./session";

// 再認証の結果。verified: 現在のパスワードが認められ、新しいセッションを採用した(利用者のIDを持つ)。failed: 認められなかった、または通信が届かなかった。lost: サインインを失っていた(認証サービスが現在の利用者を拒否した)。
export type ReauthenticationResult =
  | { readonly kind: "verified"; readonly userId: string }
  | { readonly kind: "failed"; readonly failure: AuthFailure }
  | { readonly kind: "lost" };

// 認証サービスに、現在のパスワードで再認証させる(新しいセッションの採用を含む)。例外は投げず、結果は値で返す。
// 喪失の確定に、サインインの状態の読み取り(更新を強制する)を使う。
export type DeleteAccountAuthenticator = SessionReader & {
  reauthenticate(request: Reauthentication): Promise<ReauthenticationResult>;
};

// アカウントの削除の結果。deleted: 削除された。failed: 削除されなかった(理由つき)。
// unreachableは、結果が分からない(削除が行われている場合を含む)ことを表す。それ以外は、削除が行われなかったことが確実である。
export type AccountDeletionResult =
  | { readonly kind: "deleted" }
  | { readonly kind: "failed"; readonly failure: AuthFailure };

// データベースに、サインイン中の利用者のアカウントと記録を削除させる。例外は投げず、結果は値で返す。
export type AccountDeletion = {
  delete(): Promise<AccountDeletionResult>;
};

// この端末にある、指定した利用者の記録の消去。他の利用者の記録は消さない。失敗は投げる。
export type LocalRecordsEraser = {
  erase(userId: string): Promise<void>;
};

export type DeleteAccount = {
  submit(
    input: { password: string },
    view: ScreenView<DeleteAccountFlow, DeleteAccountEvent>,
  ): Promise<void>;
};

type Dependencies = {
  authenticator: DeleteAccountAuthenticator;
  account: AccountDeletion;
  eraser: LocalRecordsEraser;
  session: { holdEnd(): SessionEndHold | null };
  connectivity: Pick<Connectivity, "isOffline">;
};

// 失敗は全て、トークンを消費したうえで、チェックをやり直させる。画面を離れたときは、表示しない。
function showFailure(
  view: ScreenView<DeleteAccountFlow, DeleteAccountEvent>,
  failure: AuthFailure,
) {
  if (!view.isMounted()) return;
  view.dispatch({ type: "failed", failure });
  view.resetCheck();
}

// 削除の手続き。開始の命令の後、セッションの終了の実行中を保持して、次の順に進める。
// 再認証 → 削除 → (成功なら)端末の記録の消去 → サインインの終了と遷移。
// 削除が行われなかった、または結果が分からないときは、保持を解いて理由を示す。保持の上限に達したときは、結果不明として示す。
// 保持が打ち切られた後に遅れて届いた結果は、何も変えない(端末の記録は消さず、遷移もしない)。
// 削除の応答を待つ間に画面を離れても、成功なら消去とサインインの終了を進め、表示だけしない。
export function createDeleteAccount({
  authenticator,
  account,
  eraser,
  session,
  connectivity,
}: Dependencies): DeleteAccount {
  // 保持を解き、理由を示して入力へ戻す。
  async function giveUp(
    hold: SessionEndHold,
    view: ScreenView<DeleteAccountFlow, DeleteAccountEvent>,
    failure: AuthFailure,
  ) {
    showFailure(view, failure);
    await hold.release();
  }

  // 削除は済んでいる。消去の失敗は握りつぶす(残った記録は、利用者のIDが違うため表示も送信もされない)。
  async function finish(
    hold: SessionEndHold,
    view: ScreenView<DeleteAccountFlow, DeleteAccountEvent>,
    userId: string,
  ) {
    try {
      await eraser.erase(userId);
    } catch {
      // 削除は済んでおり、残りは表示も送信もされない。
    }
    const ended = await hold.complete();
    // サインインの終了を確かめられなかった。削除と消去は済んでいるため、保持を解き、通信エラーを示す。
    if (ended.kind === "failed") await giveUp(hold, view, UNREACHABLE);
  }

  async function run(
    request: Reauthentication,
    hold: SessionEndHold,
    view: ScreenView<DeleteAccountFlow, DeleteAccountEvent>,
  ) {
    const reauthentication = await authenticator.reauthenticate(request);
    if (!hold.isActive()) return;
    if (reauthentication.kind === "lost") {
      // 喪失は、更新を強制した読み取りと、保持を解いたときの状態の確認が確定して、サインインへ移す。
      await authenticator.readSession({ refresh: true });
      if (hold.isActive()) await giveUp(hold, view, UNREACHABLE);
      return;
    }
    if (reauthentication.kind === "failed") {
      await giveUp(hold, view, reauthentication.failure);
      return;
    }
    const deletion = await account.delete();
    if (!hold.isActive()) return;
    hold.disarm();
    if (deletion.kind === "failed") {
      await giveUp(hold, view, deletion.failure);
      return;
    }
    await finish(hold, view, reauthentication.userId);
  }

  return {
    async submit(input, view) {
      // 送信の直前に1回だけ読む(購読しない)。判定は集約が行う。
      const offline = connectivity.isOffline();
      const request = view.begin((flow) =>
        beginDeleteAccount(flow, { password: input.password, offline }),
      );
      if (!request) return;
      const hold = session.holdEnd();
      // セッションの終了が実行中(サインアウト中)のため、削除を始められない。
      if (hold === null) {
        showFailure(view, UNREACHABLE);
        return;
      }
      const expired = hold.expired.then(() => showFailure(view, UNREACHABLE));
      await Promise.race([run(request, hold, view), expired]);
    },
  };
}
