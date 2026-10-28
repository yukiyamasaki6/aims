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

// パスワードを変え、変えられたら全ての端末のサインインを終えさせる、サーバーへの1回の要求。結果はパスワードの変更の結果である。
// 要求がサーバーに届いた後は、画面を離れても閉じても、変更と終了の両方が行われる。
// 例外: 投げることがある(要求が届かない、応答を受け取れない)。手続きが通信エラーの失敗として扱う。
// サーバーの手続き(password-change.ts)がこの約束を満たし、要求の入口の関数として画面の入口が渡す。
export type PasswordChange = {
  change(password: string): Promise<CallResult>;
};

// ページ全体を読み込み直して進む遷移。履歴に残し、前の画面の状態とクライアントのキャッシュを捨てる(ルーターで進む遷移はNavigation)。
// 例外: 投げることがあり、手続きが通信エラーの失敗として扱う。
export type PageLoad = { load(path: string): void };

type Dependencies = {
  authenticator: Omit<PasswordSetupAuthenticator, "setPassword">;
  passwordChange: PasswordChange;
  pageLoad: PageLoad;
};

export function createResetPassword({
  authenticator,
  passwordChange,
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
      setPassword(passwordChange, pageLoad, input, view),
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

// パスワードの変更をサーバーへ頼む(全ての端末のサインインの終了も、同じ要求でサーバーが行う)。
// 変更に成功し、画面が表示中なら、終了の結果によらず、サインインの画面へ移る(自動ではサインインしない)。
// 応答待ちに画面を離れたときは、表示も遷移もしない(変更と終了はサーバーで完了する)。
// 遷移が投げたときは、通信エラーとして失敗にし、実行中を解除する。
async function setPassword(
  passwordChange: PasswordChange,
  pageLoad: PageLoad,
  input: { password: string },
  view: PasswordSetupView,
) {
  const change = async (password: string): Promise<CallResult> => {
    try {
      return await passwordChange.change(password);
    } catch {
      return UNREACHABLE;
    }
  };
  if (!(await applyPassword(change, input, view))) return;
  // applyPasswordの中の確かめの後、ここで再開するまでの間にも画面は離れうるため、遷移の直前に確かめ直す(離脱の原則)。
  if (!view.isMounted()) return;
  view.dispatch({ type: "passwordSet" });
  try {
    pageLoad.load(signInHref(null));
  } catch {
    if (view.isMounted()) {
      view.dispatch({ type: "failed", failure: UNREACHABLE });
    }
  }
}
