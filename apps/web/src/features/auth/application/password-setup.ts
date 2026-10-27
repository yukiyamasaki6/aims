import type { AuthFailure } from "../domain/auth-failure";
import {
  type Check,
  checkResend,
  checkSetPassword,
  checkVerifyCode,
  type PasswordSetupEvent,
  type PasswordSetupFlow,
} from "../domain/password-setup-flow";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";
import type { ScreenView } from "./screen-view";

// 認証コードで本人確認をして、パスワードを設定する手続き(サインアップとパスワード再設定)が共有する順序。
// 手続きごとに違うのは、コードの送信の前の確認と、パスワード設定の後の動作だけで、それぞれの手続きのファイルが持つ。

export type PasswordSetupView = ScreenView<
  PasswordSetupFlow,
  PasswordSetupEvent
>;

// 画面が呼ぶ操作。
export type PasswordSetup = {
  sendCode(input: { email: string }, view: PasswordSetupView): Promise<void>;
  resend(input: { email: string }, view: PasswordSetupView): Promise<void>;
  verifyCode(
    input: { email: string; code: string },
    view: PasswordSetupView,
  ): Promise<void>;
  setPassword(
    input: { password: string },
    view: PasswordSetupView,
  ): Promise<void>;
};

export const UNREACHABLE: AuthFailure = { kind: "unreachable" };

// 操作を始められるかを判定し、始められるなら実行中にして、判定の結果を返す。
// 実行中なら何もせず、入力の不備なら示して、nullを返す。
export function begin<Ready extends object>(
  check: Check<Ready>,
  view: PasswordSetupView,
  operation: Extract<PasswordSetupEvent, { type: "started" }>["operation"],
): Ready | null {
  if (check.kind === "busy") return null;
  if (check.kind === "invalid") {
    view.dispatch({ type: "invalid", fieldErrors: check.fieldErrors });
    return null;
  }
  view.dispatch({ type: "started", operation });
  return check;
}

// コードの送信の依頼。応答があれば、成功でも拒否でも、使ったトークンは消費し、チェックをやり直させる。
// 送信中に画面を離れたときは、状態を変えず、チェックのやり直しもしない。
export async function deliver(
  authenticator: PasswordSetupAuthenticator,
  { email, captchaToken }: { email: string; captchaToken: string },
  view: PasswordSetupView,
  sent: Extract<PasswordSetupEvent, { type: "codeSent" | "codeResent" }>,
) {
  const delivery = await authenticator.sendCode({ email, captchaToken });
  if (!view.isMounted()) return;
  if (delivery.kind === "unreached") {
    view.dispatch({ type: "failed", failure: UNREACHABLE });
    return;
  }
  view.dispatch(
    delivery.kind === "sent"
      ? sent
      : { type: "refused", failure: delivery.failure },
  );
  view.resetCheck();
}

export async function resend(
  authenticator: PasswordSetupAuthenticator,
  input: { email: string },
  view: PasswordSetupView,
) {
  const ready = begin(checkResend(view.state, input), view, "resend");
  if (!ready) return;
  await deliver(authenticator, ready, view, { type: "codeResent" });
}

export async function verifyCode(
  authenticator: PasswordSetupAuthenticator,
  input: { email: string; code: string },
  view: PasswordSetupView,
) {
  const ready = begin(checkVerifyCode(view.state, input), view, "verify");
  if (!ready) return;
  const failure = await authenticator.verifyCode({
    email: ready.email,
    code: ready.code,
  });
  if (!view.isMounted()) return;
  view.dispatch(
    failure ? { type: "failed", failure } : { type: "codeConfirmed" },
  );
}

// パスワードの設定の依頼。設定に成功し、画面がまだ表示中のときだけ、trueを返す(続きを行ってよい)。
// 失敗は示してfalseを返す。送信中に画面を離れたときは、状態を変えずにfalseを返す。
// 成功時は実行中を解除しない。続きの動作が終わる前に再び押され、二重に設定されるのを防ぐため。
export async function applyPassword(
  authenticator: PasswordSetupAuthenticator,
  input: { password: string },
  view: PasswordSetupView,
): Promise<boolean> {
  const ready = begin(checkSetPassword(view.state, input), view, "setPassword");
  if (!ready) return false;
  const failure = await authenticator.setPassword(ready.password);
  if (!view.isMounted()) return false;
  if (failure) {
    view.dispatch({ type: "failed", failure });
    return false;
  }
  return true;
}
