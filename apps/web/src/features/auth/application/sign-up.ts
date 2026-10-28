import { ALREADY_REGISTERED, UNREACHABLE } from "../domain/auth-failure";
import { beginSendCode } from "../domain/password-setup-flow";
import { destinationOf } from "../domain/routes";
import type { Navigation } from "./navigation";
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

// メールアドレスが登録済みかの判定。
// 例外: 投げることがあり、手続きが通信エラーの失敗として扱う。
type RegistrationLookup = {
  isRegistered(email: string): Promise<boolean>;
};

type Dependencies = {
  authenticator: PasswordSetupAuthenticator;
  registration: RegistrationLookup;
  navigation: Pick<Navigation, "go">;
};

export function createSignUp({
  authenticator,
  registration,
  navigation,
}: Dependencies): PasswordSetup {
  const context: PasswordSetupContext = { authenticator, purpose: "sign-up" };
  return {
    sendCode: (input, view) => sendCode(context, registration, input, view),
    resend: (input, view) => resend(context, input, view),
    verifyCode: (input, view) => verifyCode(context, input, view),
    setPassword: (input, view) =>
      setPassword(authenticator, navigation, input, view),
  };
}

// 登録済みのメールアドレスには、コードを送らない。登録の有無を確かめられないときと、確認の待ちで画面を離れたときも、送らない。
async function sendCode(
  context: PasswordSetupContext,
  registration: RegistrationLookup,
  input: { email: string },
  view: PasswordSetupView,
) {
  const request = view.begin((flow) => beginSendCode(flow, input));
  if (!request) return;
  let failure: typeof ALREADY_REGISTERED | typeof UNREACHABLE | null;
  try {
    failure = (await registration.isRegistered(request.email))
      ? ALREADY_REGISTERED
      : null;
  } catch {
    failure = UNREACHABLE;
  }
  // 送信中に画面を離れたときは、状態を変えず、チェックのやり直しもしない。
  if (!view.isMounted()) return;
  // 登録済みの判定と、判定の失敗は、トークンを使っていないので消費しない。
  if (failure) {
    view.dispatch({ type: "failed", failure });
    return;
  }
  await deliver(context, request, view, { type: "codeSent" });
}

// 設定に成功したら、ラウンド一覧へ遷移する。遷移が投げたときは、通信エラーとして失敗にし、実行中のまま止めない。
async function setPassword(
  authenticator: Pick<PasswordSetupAuthenticator, "setPassword">,
  navigation: Pick<Navigation, "go">,
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
  // 遷移の直前に、画面が表示中かを確かめ直す(再設定と同じ理由。離脱の原則)。
  if (!view.isMounted()) return;
  view.dispatch({ type: "passwordSet" });
  try {
    navigation.go(destinationOf(null));
  } catch {
    view.dispatch({ type: "failed", failure: UNREACHABLE });
  }
}
