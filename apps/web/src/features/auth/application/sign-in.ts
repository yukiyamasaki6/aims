import type { PageNavigation } from "@/lib/page-navigation/contract/page-navigation";
import { destinationOf } from "../domain/auth-routes";
import {
  beginSignIn,
  type Credentials,
  type SignInEvent,
  type SignInFlow,
} from "../domain/sign-in-flow";
import { type CallResult, failureOf } from "./call-result";
import type { ScreenView } from "./screen-view";

// 認証サービスに資格情報を照合させる。例外は投げず、結果は値で返す。
export type SignInAuthenticator = {
  signIn(credentials: Credentials): Promise<CallResult>;
};

export type SignIn = {
  submit(
    // from: 画面が受けた遷移元の値。検証していない値で、無ければnull。検証は手続きが経路の規則で行う。
    input: { email: string; password: string; from: string | null },
    view: ScreenView<SignInFlow, SignInEvent>,
  ): Promise<void>;
};

export function createSignIn({
  authenticator,
  pageNavigation,
}: {
  authenticator: SignInAuthenticator;
  pageNavigation: PageNavigation;
}): SignIn {
  return {
    async submit(input, view) {
      const credentials = view.begin((flow) =>
        beginSignIn(flow, { email: input.email, password: input.password }),
      );
      if (!credentials) return;
      const result = await authenticator.signIn(credentials);
      // 送信中に画面を離れたときは、状態を変えず、遷移もしない。
      if (!view.isMounted()) return;
      const failure = failureOf(result);
      // 失敗は全て、トークンを消費したうえで、チェックをやり直させる。
      if (failure) {
        view.dispatch({ type: "failed", failure });
        view.resetCheck();
        return;
      }
      // 成功時は以前のエラーを消し、送信中は解除しない。遷移が終わる前に再び押され、使用済みのトークンで二重に送信されるのを防ぐため。
      view.dispatch({ type: "signedIn" });
      pageNavigation.go(destinationOf(input.from));
    },
  };
}
