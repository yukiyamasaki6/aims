import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { AuthFailure } from "../domain/auth-failure";
import { destinationOf } from "../domain/auth-routes";
import { googleReturnOf, withoutGoogleReturn } from "../domain/google-return";
import {
  beginGoogleReturn,
  beginGoogleSignIn,
  type GoogleSignInEvent,
  type GoogleSignInFlow,
} from "../domain/google-sign-in-flow";
import { type CallResult, failureOf } from "./call-result";
import type { PageAddress } from "./page-address";
import type { PageReplace } from "./page-replace";
import type { ScreenView } from "./screen-view";

// 認証サービスにGoogleでのサインインを頼む。例外は投げず、結果は値で返す。
// startGoogleSignIn: Googleの画面へ移す(移った後は結果を受け取らない)。失敗(検証子を保存できないなど)は値で返す。returnPathは今のオリジンからの戻り先。
// exchangeGoogleCode: 戻りの`code`をセッションに交換する。成功のSIGNED_INが端末の識別情報と手段を書く。
export type GoogleSignInAuthenticator = {
  startGoogleSignIn(request: { returnPath: string }): Promise<CallResult>;
  exchangeGoogleCode(code: string): Promise<CallResult>;
};

type GoogleSignInView = ScreenView<GoogleSignInFlow, GoogleSignInEvent>;

// サインインとサインアップが共有する、Googleでの認証の手続き。
export type GoogleSignIn = {
  // 押下。オフラインなら示して留まり、そうでなければGoogleの画面へ移す。
  start(input: { returnPath: string }, view: GoogleSignInView): Promise<void>;
  // 画面の読み込み後に1回呼ぶ。今のURLが戻りなら、戻りを外し、`code`を交換して遷移するか、理由を示す。
  // destination: 遷移元の値(検証していない値で、無ければnull)。検証は経路の規則で行う。
  resume(
    input: { destination: string | null },
    view: GoogleSignInView,
  ): Promise<void>;
};

export function createGoogleSignIn({
  authenticator,
  address,
  pageReplace,
  connectivity,
}: {
  authenticator: GoogleSignInAuthenticator;
  address: PageAddress;
  pageReplace: Pick<PageReplace, "replace">;
  connectivity: Pick<Connectivity, "isOffline">;
}): GoogleSignIn {
  // 表示中のときだけ、失敗を示す(離れた画面は表示しない)。
  function show(view: GoogleSignInView, failure: AuthFailure) {
    if (view.isMounted()) view.dispatch({ type: "failed", failure });
  }

  return {
    async start(input, view) {
      // 送信の直前に1回だけ読む(購読しない)。判定は集約が行う。
      const offline = connectivity.isOffline();
      if (!view.begin((flow) => beginGoogleSignIn(flow, { offline }))) return;
      // 成功では、SDKがGoogleの画面へ移す。実行中は解除しない(bfcacheで戻ったときは画面が解く)。
      const failure = failureOf(
        await authenticator.startGoogleSignIn({ returnPath: input.returnPath }),
      );
      if (failure) show(view, failure);
    },
    async resume(input, view) {
      const search = address.search();
      const googleReturn = googleReturnOf(search);
      if (googleReturn === null) return;
      // 再読み込みで同じ戻りを繰り返さないよう、先に戻りを外す。
      address.rewrite(withoutGoogleReturn(search));
      if (googleReturn.kind === "cancelled") {
        show(view, { kind: "google_cancelled" });
        return;
      }
      // 追加専用の戻り(taken)はサインインでは起こらないため、その他の失敗と同じに扱う。
      if (googleReturn.kind === "failed" || googleReturn.kind === "taken") {
        show(view, { kind: "other" });
        return;
      }
      if (!view.begin(beginGoogleReturn)) return;
      const failure = failureOf(
        await authenticator.exchangeGoogleCode(googleReturn.code),
      );
      // 画面を離れた後は、表示も遷移もしない。
      if (!view.isMounted()) return;
      if (failure) {
        view.dispatch({ type: "failed", failure });
        return;
      }
      // 成功時は実行中を解除しない。遷移が終わるまでの再押下を防ぐため。
      pageReplace.replace(destinationOf(input.destination));
    },
  };
}
