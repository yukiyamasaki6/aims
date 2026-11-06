import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { PageNavigation } from "@/lib/page-navigation/contract/page-navigation";
import { SIGN_IN_PATH } from "../domain/auth-routes";
import type { CallResult } from "./call-result";
import {
  applyPassword,
  type PasswordSetup,
  type PasswordSetupContext,
  type PasswordSetupView,
  sendCode,
  tickCooldown,
  verifyCode,
} from "./password-setup";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";

// この端末のサインインを終える頼みごと。例外は投げない。結果は見ない(他の端末のサインインの終了は、認証サービスがパスワードの変更時に行う)。
type LocalSignOut = {
  signOutHere(): Promise<CallResult>;
};

type Dependencies = {
  authenticator: PasswordSetupAuthenticator & LocalSignOut;
  pageNavigation: Pick<PageNavigation, "go">;
  clock: Clock;
  connectivity: Pick<Connectivity, "isOffline">;
};

export function createResetPassword({
  authenticator,
  pageNavigation,
  clock,
  connectivity,
}: Dependencies): PasswordSetup {
  const context: PasswordSetupContext = {
    authenticator,
    purpose: "password-reset",
    clock,
    connectivity,
  };
  return {
    sendCode: (input, view) => sendCode(context, input, view),
    verifyCode: (input, view) => verifyCode(context, input, view),
    tickCooldown: (dispatch) => tickCooldown(context, dispatch),
    setPassword: (input, view) =>
      setPassword(authenticator, connectivity, pageNavigation, input, view),
  };
}

// パスワードを変え、変えられて画面が表示中なら、この端末のサインインを終えて、サインインの画面へ移る(自動ではサインインしない)。
// 他の端末のサインインは、認証サービスがパスワードの変更時に終える。端末のサインインの終了の結果は見ない。
// 変更の応答待ちに画面を離れたときは、表示も遷移もしない。
async function setPassword(
  authenticator: PasswordSetupAuthenticator & LocalSignOut,
  connectivity: Pick<Connectivity, "isOffline">,
  pageNavigation: Pick<PageNavigation, "go">,
  input: { password: string },
  view: PasswordSetupView,
) {
  if (
    !(await applyPassword(
      (password) => authenticator.setPassword(password),
      connectivity,
      input,
      view,
    ))
  ) {
    return;
  }
  view.dispatch({ type: "passwordSet" });
  await authenticator.signOutHere();
  pageNavigation.go(SIGN_IN_PATH);
}
