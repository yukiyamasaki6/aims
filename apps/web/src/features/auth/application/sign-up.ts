import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { destinationOf } from "../domain/auth-routes";
import { type CallResult, failureOf } from "./call-result";
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
import type { SignInAuthenticator } from "./sign-in";

// この端末以外のサインインを終える頼みごと。例外は投げない。
export type OtherSessionsSignOut = {
  signOutOthers(): Promise<CallResult>;
};

type Dependencies = {
  authenticator: PasswordSetupAuthenticator &
    SignInAuthenticator &
    OtherSessionsSignOut;
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
    requiresCheck: true,
  };
  return {
    requiresCheck: context.requiresCheck,
    sendCode: (input, view) => sendCode(context, input, view),
    verifyCode: (input, view) => verifyCode(context, input, view),
    tickCooldown: (dispatch) => tickCooldown(context, dispatch),
    // 認証コード由来のセッションは、現在のパスワードの検査を免除されるため、設定の後に置き換える。
    // (1)パスワードの設定、(2)パスワードでのサインイン(新しいセッション)、(3)新しいセッションからの、他のセッションの終了、の順に行う。
    // (3)の完了を待ってから、サインインの後の既定の行き先へ遷移する。
    // (1)の成功の後は、画面を離れても(2)(3)を進め、遷移だけ行わない。
    setPassword: async (input, view) => {
      const applied = await applyPassword(context, input, view);
      if (!applied) return;
      // 同じパスワードの拒否は、(2)の失敗の後の再試行で、既に設定済みの場合だけ起きる。設定済みとして(2)へ進む。
      const failure = failureOf(applied.result);
      if (failure && failure.kind !== "same_password") {
        if (applied.mounted) view.dispatch({ type: "failed", failure });
        return;
      }
      // 使ったトークンは、結果によらず消費したものとして、失敗では取り直させる。
      const signedIn = failureOf(
        await authenticator.signIn({
          email: input.email,
          password: applied.request.password,
          captchaToken: applied.request.captchaToken ?? "",
        }),
      );
      if (signedIn) {
        view.dispatch({ type: "refused", failure: signedIn });
        view.resetCheck();
        return;
      }
      // 結果は見ない。失敗しても遷移し、示さない(古いセッションだけが残る)。
      await authenticator.signOutOthers();
      if (view.isMounted()) pageReplace.replace(destinationOf(null));
    },
  };
}
