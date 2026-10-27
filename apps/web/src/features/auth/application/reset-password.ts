import type { AuthFailure } from "../domain/auth-failure";
import { checkSendCode } from "../domain/password-setup-flow";
import { signInHref } from "../domain/return-to";
import {
  applyPassword,
  begin,
  deliver,
  type PasswordSetup,
  type PasswordSetupView,
  resend,
  UNREACHABLE,
  verifyCode,
} from "./password-setup";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";

// パスワード再設定が認証サービスに頼むこと。共通の約束に、全ての端末のサインインの終了を足す。
// 終了を依頼できたとき(認証サービスが応答したとき。値のエラーを含む)はnull、応答が無かったときは失敗を返す。
export type ResetPasswordAuthenticator = PasswordSetupAuthenticator & {
  signOutEverywhere(): Promise<AuthFailure | null>;
};

// ページ全体を読み込み直す遷移。前の画面の状態とクライアントのキャッシュを捨てる。投げることがあり、手続きが失敗として扱う。
export type PageLoad = { load(path: string): void };

type Dependencies = {
  authenticator: ResetPasswordAuthenticator;
  pageLoad: PageLoad;
};

export function createResetPassword({
  authenticator,
  pageLoad,
}: Dependencies): PasswordSetup {
  return {
    sendCode: (input, view) => sendCode(authenticator, input, view),
    resend: (input, view) => resend(authenticator, input, view),
    verifyCode: (input, view) => verifyCode(authenticator, input, view),
    setPassword: (input, view) =>
      setPassword(authenticator, pageLoad, input, view),
  };
}

// メールアドレスが登録済みかは判定しない(登録の有無を画面に出さない)。
async function sendCode(
  authenticator: ResetPasswordAuthenticator,
  input: { email: string },
  view: PasswordSetupView,
) {
  const ready = begin(checkSendCode(view.state, input), view, "send");
  if (!ready) return;
  await deliver(authenticator, ready, view, { type: "codeSent" });
}

// 設定に成功したら、その利用者の全ての端末のサインインを終えさせ、サインインの画面へ移る(自動ではサインインしない)。
// 設定の応答前に画面を離れたときは、終了も遷移も行わない(applyPassword)。
// 終了の応答待ちに画面を離れたときは、終了が投げなければ、応答後に遷移する(状態は更新しない)。
// 終了か遷移が投げたときは、表示中なら通信エラーとして失敗にし、実行中を解除する。
async function setPassword(
  authenticator: ResetPasswordAuthenticator,
  pageLoad: PageLoad,
  input: { password: string },
  view: PasswordSetupView,
) {
  if (!(await applyPassword(authenticator, input, view))) return;
  const failure = await authenticator.signOutEverywhere();
  if (failure) {
    if (view.isMounted()) view.dispatch({ type: "failed", failure });
    return;
  }
  try {
    pageLoad.load(signInHref(null));
  } catch {
    if (view.isMounted()) {
      view.dispatch({ type: "failed", failure: UNREACHABLE });
    }
  }
}
