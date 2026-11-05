import type { Clock } from "@/lib/clock/contract/clock";
import {
  beginResend,
  beginSetPassword,
  beginVerifyCode,
  type PasswordSetupEvent,
  type PasswordSetupFlow,
} from "../domain/password-setup-flow";
import { failureOf } from "./call-result";
import type {
  CodePurpose,
  PasswordSetupAuthenticator,
} from "./password-setup-authenticator";
import type { ScreenView } from "./screen-view";

// 認証コードで本人確認をして、パスワードを設定する手続き(サインアップとパスワード再設定)が共有する順序。
// 手続きごとに違うのは、コードの目的、コードの送信の前の確認、パスワードの設定を頼む先、パスワード設定の後の動作で、それぞれの手続きのファイルが持つ。

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
  // 再送の待ちを1秒進める出来事を、1秒後に1回送る予約。返す関数で取り消す。
  tickCooldown(dispatch: PasswordSetupView["dispatch"]): () => void;
};

// 共有の順序が使う、認証サービスと、手続きごとのコードの目的。
export type PasswordSetupContext = {
  authenticator: Omit<PasswordSetupAuthenticator, "setPassword">;
  purpose: CodePurpose;
  clock: Clock;
};

// 再送の待ちの1秒の予約(業務の時間)。
const COOLDOWN_TICK_MS = 1000;

export function tickCooldown(
  { clock }: PasswordSetupContext,
  dispatch: PasswordSetupView["dispatch"],
): () => void {
  return clock.after(COOLDOWN_TICK_MS, () =>
    dispatch({ type: "cooldownTicked" }),
  );
}

// コードの送信の依頼。成功でも失敗でも、トークンは消費し、チェックをやり直させる。
export async function deliver(
  { authenticator, purpose }: PasswordSetupContext,
  { email, captchaToken }: { email: string; captchaToken: string },
  view: PasswordSetupView,
  sent: Extract<PasswordSetupEvent, { type: "codeSent" | "codeResent" }>,
) {
  const result = await authenticator.sendCode({ purpose, email, captchaToken });
  view.dispatch(
    result.kind === "accepted"
      ? sent
      : { type: "refused", failure: result.failure },
  );
  view.resetCheck();
}

export async function resend(
  context: PasswordSetupContext,
  input: { email: string },
  view: PasswordSetupView,
) {
  const request = view.begin((flow) => beginResend(flow, input));
  if (!request) return;
  await deliver(context, request, view, { type: "codeResent" });
}

export async function verifyCode(
  { authenticator, purpose }: PasswordSetupContext,
  input: { email: string; code: string },
  view: PasswordSetupView,
) {
  const request = view.begin((flow) => beginVerifyCode(flow, input));
  if (!request) return;
  const result = await authenticator.verifyCode({ purpose, ...request });
  const failure = failureOf(result);
  view.dispatch(
    failure ? { type: "failed", failure } : { type: "codeConfirmed" },
  );
}

// パスワードの設定の依頼。頼む先は手続きが渡す(サインアップはブラウザから、再設定はサーバーの1回の要求で全端末のサインインの終了と合わせて)。
// 設定に成功し、画面がまだ表示中のときだけ、trueを返す(続きを行ってよい)。
// 失敗は示してfalseを返す。送信中に画面を離れたときは、状態を変えずにfalseを返す。
// 成功時は実行中を解除しない。続きの動作が終わる前に再び押され、二重に設定されるのを防ぐため。
export async function applyPassword(
  setPassword: PasswordSetupAuthenticator["setPassword"],
  input: { password: string },
  view: PasswordSetupView,
): Promise<boolean> {
  const request = view.begin((flow) => beginSetPassword(flow, input));
  if (!request) return false;
  const result = await setPassword(request.password);
  if (!view.isMounted()) return false;
  const failure = failureOf(result);
  if (failure) {
    view.dispatch({ type: "failed", failure });
    return false;
  }
  return true;
}
