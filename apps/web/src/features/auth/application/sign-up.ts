import type { Clock } from "@/lib/clock/contract/clock";
import type { PageNavigation } from "@/lib/page-navigation/contract/page-navigation";
import { destinationOf } from "../domain/auth-routes";
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

type Dependencies = {
  authenticator: PasswordSetupAuthenticator;
  pageNavigation: Pick<PageNavigation, "go">;
  clock: Clock;
};

export function createSignUp({
  authenticator,
  pageNavigation,
  clock,
}: Dependencies): PasswordSetup {
  const context: PasswordSetupContext = {
    authenticator,
    purpose: "sign-up",
    clock,
  };
  return {
    sendCode: (input, view) => sendCode(context, input, view),
    verifyCode: (input, view) => verifyCode(context, input, view),
    tickCooldown: (dispatch) => tickCooldown(context, dispatch),
    setPassword: (input, view) =>
      setPassword(authenticator, pageNavigation, input, view),
  };
}

// 設定に成功したら、サインインの後の既定の行き先へ遷移する。
async function setPassword(
  authenticator: Pick<PasswordSetupAuthenticator, "setPassword">,
  pageNavigation: Pick<PageNavigation, "go">,
  input: { password: string },
  view: PasswordSetupView,
) {
  if (
    !(await applyPassword(
      (password) => authenticator.setPassword(password),
      input,
      view,
    ))
  ) {
    return;
  }
  view.dispatch({ type: "passwordSet" });
  pageNavigation.go(destinationOf(null));
}
