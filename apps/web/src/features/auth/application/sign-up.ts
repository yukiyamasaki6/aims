import type { Clock } from "@/lib/clock/contract/clock";
import type { PageNavigation } from "@/lib/page-navigation/contract/page-navigation";
import { beginSendCode } from "../domain/password-setup-flow";
import {
  applyPassword,
  deliver,
  type PasswordSetup,
  type PasswordSetupContext,
  type PasswordSetupView,
  resend,
  tickCooldown,
  verifyCode,
} from "./password-setup";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";

type Dependencies = {
  authenticator: PasswordSetupAuthenticator;
  pageNavigation: Pick<PageNavigation, "go">;
  clock: Clock;
  // 保護対象の画面の範囲の根の経路。サインインの後の既定の行き先になる。
  protectedPath: string;
};

export function createSignUp({
  authenticator,
  pageNavigation,
  clock,
  protectedPath,
}: Dependencies): PasswordSetup {
  const context: PasswordSetupContext = {
    authenticator,
    purpose: "sign-up",
    clock,
  };
  return {
    sendCode: (input, view) => sendCode(context, input, view),
    resend: (input, view) => resend(context, input, view),
    verifyCode: (input, view) => verifyCode(context, input, view),
    tickCooldown: (dispatch) => tickCooldown(context, dispatch),
    setPassword: (input, view) =>
      setPassword(authenticator, pageNavigation, protectedPath, input, view),
  };
}

// 登録済みの確認済み利用者には、認証サービスがコードの代わりに案内のメールを送る。画面は登録の有無を区別せず、再設定と同じ順序でコード入力へ進める。
async function sendCode(
  context: PasswordSetupContext,
  input: { email: string },
  view: PasswordSetupView,
) {
  const request = view.begin((flow) => beginSendCode(flow, input));
  if (!request) return;
  await deliver(context, request, view, { type: "codeSent" });
}

// 設定に成功したら、サインインの後の既定の行き先へ遷移する。
async function setPassword(
  authenticator: Pick<PasswordSetupAuthenticator, "setPassword">,
  pageNavigation: Pick<PageNavigation, "go">,
  protectedPath: string,
  input: { password: string },
  view: PasswordSetupView,
) {
  if (
    !(await applyPassword(
      (password) => authenticator.setPassword(password),
      input,
      view,
    ))
  ) {
    return;
  }
  view.dispatch({ type: "passwordSet" });
  pageNavigation.go(protectedPath);
}
