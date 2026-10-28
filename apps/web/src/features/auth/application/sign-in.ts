import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import { destinationOf } from "../domain/routes";
import {
  beginSignIn,
  type Credentials,
  type SignInEvent,
  type SignInFlow,
} from "../domain/sign-in-flow";
import { type CallResult, failureOf } from "./call-result";
import type { Navigation } from "./navigation";
import type { ScreenView } from "./screen-view";

// 認証サービスに資格情報を照合させる。例外は投げず、結果は値で返す。
export type SignInAuthenticator = {
  signIn(credentials: Credentials): Promise<CallResult>;
};

export type SignIn = {
  submit(
    input: { email: string; password: string },
    view: ScreenView<SignInFlow, SignInEvent>,
  ): Promise<void>;
};

export function createSignIn({
  authenticator,
  navigation,
}: {
  authenticator: SignInAuthenticator;
  navigation: Navigation;
}): SignIn {
  return {
    async submit(input, view) {
      const credentials = view.begin((flow) => beginSignIn(flow, input));
      if (!credentials) return;
      // 失敗は、状態を失敗にし、使ったトークンを消費済みにしたうえで、チェックをやり直させる。
      const fail = (failure: AuthFailure) => {
        view.dispatch({ type: "failed", failure });
        view.resetCheck();
      };
      const result = await authenticator.signIn(credentials);
      // 送信中に画面を離れたときは、状態を変えず、遷移もしない。
      if (!view.isMounted()) return;
      const failure = failureOf(result);
      if (failure) {
        fail(failure);
        return;
      }
      // 成功時は送信中を解除しない。遷移が終わる前に再び押され、使用済みのトークンで二重に送信されるのを防ぐため。
      // 遷移元の読み出しと遷移が投げたときは、通信エラーとして失敗にし、送信中のまま止めない。
      try {
        navigation.go(destinationOf(navigation.returnTo()));
      } catch {
        fail(UNREACHABLE);
      }
    },
  };
}
