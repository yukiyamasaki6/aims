import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { destinationOf } from "../domain/auth-routes";
import type { PageReplace } from "./page-replace";
import {
  applyPassword,
  type PasswordSetup,
  type PasswordSetupContext,
  sendCode,
  tickCooldown,
  verifyCode,
} from "./password-setup";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";

type Dependencies = {
  authenticator: PasswordSetupAuthenticator;
  pageReplace: Pick<PageReplace, "replace">;
  clock: Clock;
  connectivity: Pick<Connectivity, "isOffline">;
};

export function createSignUp({
  authenticator,
  pageReplace,
  clock,
  connectivity,
}: Dependencies): PasswordSetup {
  const context: PasswordSetupContext = {
    authenticator,
    purpose: "sign-up",
    clock,
    connectivity,
  };
  return {
    sendCode: (input, view) => sendCode(context, input, view),
    verifyCode: (input, view) => verifyCode(context, input, view),
    tickCooldown: (dispatch) => tickCooldown(context, dispatch),
    // 設定に成功したら、サインインの後の既定の行き先へ遷移する。
    setPassword: async (input, view) => {
      if (await applyPassword(context, input, view)) {
        pageReplace.replace(destinationOf(null));
      }
    },
  };
}
