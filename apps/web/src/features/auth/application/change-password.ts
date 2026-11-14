import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  beginChangePassword,
  type ChangePasswordEvent,
  type ChangePasswordFlow,
  type PasswordChange,
} from "../domain/change-password-flow";
import { type CallResult, failureOf } from "./call-result";
import type { ScreenView } from "./screen-view";

// 認証サービスに、サインイン済みの利用者のパスワードを更新させる。例外は投げず、結果は値で返す。
// 現在のパスワードの確認は認証サービスが行う。他の端末のサインインは、更新の成功で認証サービスが終える。
export type ChangePasswordAuthenticator = {
  updatePassword(request: PasswordChange): Promise<CallResult>;
};

export type ChangePassword = {
  submit(
    input: PasswordChange,
    view: ScreenView<ChangePasswordFlow, ChangePasswordEvent>,
  ): Promise<void>;
};

export function createChangePassword({
  authenticator,
  connectivity,
}: {
  authenticator: ChangePasswordAuthenticator;
  connectivity: Pick<Connectivity, "isOffline">;
}): ChangePassword {
  return {
    async submit(input, view) {
      // 送信の直前に1回だけ読む(購読しない)。判定は集約が行う。
      const offline = connectivity.isOffline();
      const request = view.begin((flow) =>
        beginChangePassword(flow, { ...input, offline }),
      );
      if (!request) return;
      const result = await authenticator.updatePassword(request);
      // 送信中に画面を離れたときは、状態を更新しない。更新の呼び出しは取り消さない。
      if (!view.isMounted()) return;
      const failure = failureOf(result);
      view.dispatch(
        failure ? { type: "failed", failure } : { type: "changed" },
      );
    },
  };
}
