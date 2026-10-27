import type { AuthFailure } from "../domain/auth-failure";
import { destinationOf } from "../domain/return-to";
import {
  type Credentials,
  checkSignIn,
  type SignInAction,
  type SignInAttempt,
} from "../domain/sign-in-attempt";
import type { Navigation } from "./navigation";
import type { ScreenView } from "./screen-view";

// 認証サービスに資格情報を照合させる。成功ならnull、失敗なら失敗の種類を返し、例外を投げない。
export type SignInAuthenticator = {
  signIn(credentials: Credentials): Promise<AuthFailure | null>;
};

export type SignIn = {
  submit(
    input: { email: string; password: string },
    view: ScreenView<SignInAttempt, SignInAction>,
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
      const check = checkSignIn(view.state, input);
      if (check.kind === "busy") return;
      if (check.kind === "invalid") {
        view.dispatch({ type: "invalid", fieldErrors: check.fieldErrors });
        return;
      }
      // 失敗は、状態を失敗にし、使ったトークンを消費済みにしたうえで、チェックをやり直させる。
      const fail = (failure: AuthFailure) => {
        view.dispatch({ type: "failed", failure });
        view.resetCheck();
      };
      view.dispatch({ type: "submitted" });
      const failure = await authenticator.signIn(check.credentials);
      // 送信中に画面を離れたときは、状態を変えず、遷移もしない。
      if (!view.isMounted()) return;
      if (failure) {
        fail(failure);
        return;
      }
      // 成功時は送信中を解除しない。遷移が終わる前に再び押され、使用済みのトークンで二重に送信されるのを防ぐため。
      // 遷移元の読み出しと遷移が投げたときは、通信エラーとして失敗にし、送信中のまま止めない。
      try {
        navigation.go(destinationOf(navigation.returnTo()));
      } catch {
        fail({ kind: "unreachable" });
      }
    },
  };
}
