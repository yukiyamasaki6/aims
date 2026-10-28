import { UNREACHABLE } from "../domain/auth-failure";
import { beginSendCode } from "../domain/password-setup-flow";
import { signInHref } from "../domain/routes";
import type { CallResult } from "./call-result";
import {
  applyPassword,
  deliver,
  type PasswordSetup,
  type PasswordSetupContext,
  type PasswordSetupView,
  resend,
  verifyCode,
} from "./password-setup";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";

// 全ての端末のサインインを終えさせる。応答があれば(拒否を含む)終了を依頼できたとして扱い、応答が無かったとき(unreachable)だけ失敗にする。
export type SignOutEverywhere = {
  signOutEverywhere(): Promise<CallResult>;
};

// ページ全体を読み込み直して進む遷移。履歴に残し、前の画面の状態とクライアントのキャッシュを捨てる(ルーターで進む遷移はNavigation)。
// 例外: 投げることがあり、手続きが通信エラーの失敗として扱う。
export type PageLoad = { load(path: string): void };

type Dependencies = {
  authenticator: PasswordSetupAuthenticator & SignOutEverywhere;
  pageLoad: PageLoad;
};

export function createResetPassword({
  authenticator,
  pageLoad,
}: Dependencies): PasswordSetup {
  const context: PasswordSetupContext = {
    authenticator,
    purpose: "password-reset",
  };
  return {
    sendCode: (input, view) => sendCode(context, input, view),
    resend: (input, view) => resend(context, input, view),
    verifyCode: (input, view) => verifyCode(context, input, view),
    setPassword: (input, view) =>
      setPassword(context, authenticator, pageLoad, input, view),
  };
}

// メールアドレスが登録済みかは判定しない(登録の有無を画面に出さない)。
async function sendCode(
  context: PasswordSetupContext,
  input: { email: string },
  view: PasswordSetupView,
) {
  const request = view.begin((flow) => beginSendCode(flow, input));
  if (!request) return;
  await deliver(context, request, view, { type: "codeSent" });
}

// 設定に成功したら、その利用者の全ての端末のサインインを終えさせ、サインインの画面へ移る(自動ではサインインしない)。
// 設定の応答前に画面を離れたときは、終了も遷移も行わない(applyPassword)。
// 終了の応答待ちに画面を離れたときは、終了が届かなかったのでなければ、応答後に遷移する(状態は更新しない)。
// 終了か遷移が投げたときは、表示中なら通信エラーとして失敗にし、実行中を解除する。
async function setPassword(
  context: PasswordSetupContext,
  signOut: SignOutEverywhere,
  pageLoad: PageLoad,
  input: { password: string },
  view: PasswordSetupView,
) {
  if (!(await applyPassword(context, input, view))) return;
  const result = await signOut.signOutEverywhere();
  if (result.kind === "unreachable") {
    if (view.isMounted()) view.dispatch({ type: "failed", failure: result });
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
