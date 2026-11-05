import type { PageNavigation } from "@/lib/page-navigation/contract/page-navigation";
import type { AuthFailure } from "../domain/auth-failure";
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

// 今の画面の遷移元の値の読み出し。検証していない値で、無ければnull。検証は手続きが経路の規則で行う。
export type ReturnToReader = {
  read(): string | null;
};

export type SignIn = {
  submit(
    input: { email: string; password: string },
    view: ScreenView<SignInFlow, SignInEvent>,
  ): Promise<void>;
};

export function createSignIn({
  authenticator,
  pageNavigation,
  returnToReader,
  protectedPath,
}: {
  authenticator: SignInAuthenticator;
  pageNavigation: PageNavigation;
  returnToReader: ReturnToReader;
  // 保護対象の画面の範囲の根の経路。遷移元の検証と、既定の行き先に使う。
  protectedPath: string;
}): SignIn {
  return {
    async submit(input, view) {
      const credentials = view.begin((flow) => beginSignIn(flow, input));
      if (!credentials) return;
      // 届いた後の失敗は、使ったトークンを消費済みにしたうえで、チェックをやり直させる。
      const refuse = (failure: AuthFailure) => {
        view.dispatch({ type: "refused", failure });
        view.resetCheck();
      };
      const result = await authenticator.signIn(credentials);
      // 送信中に画面を離れたときは、状態を変えず、遷移もしない。
      if (!view.isMounted()) return;
      const failure = failureOf(result);
      // 照合が届かなかったとき(呼び出しが投げた、通信の断を値で返した)は、トークンを使っていないので保持し、チェックをやり直さない。
      if (failure?.kind === "unreachable") {
        view.dispatch({ type: "failed", failure });
        return;
      }
      if (failure) {
        refuse(failure);
        return;
      }
      // 成功時は以前のエラーを消し、送信中は解除しない。遷移が終わる前に再び押され、使用済みのトークンで二重に送信されるのを防ぐため。
      view.dispatch({ type: "signedIn" });
      pageNavigation.go(destinationOf(returnToReader.read(), protectedPath));
    },
  };
}
