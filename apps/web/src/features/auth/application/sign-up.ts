import type { AuthFailure } from "../domain/auth-failure";
import { checkSendCode } from "../domain/password-setup-flow";
import { destinationOf } from "../domain/return-to";
import type { Navigation } from "./navigation";
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

type Unreached = { readonly kind: "unreached" };
export type Registration =
  | { readonly kind: "registered" }
  | { readonly kind: "unregistered" }
  | Unreached;

// サインアップが認証サービスに頼むこと。共通の約束に、登録済みの判定を足す。
export type SignUpAuthenticator = PasswordSetupAuthenticator & {
  isRegistered(email: string): Promise<Registration>;
};

type Dependencies = {
  authenticator: SignUpAuthenticator;
  navigation: Pick<Navigation, "go">;
};

export function createSignUp({
  authenticator,
  navigation,
}: Dependencies): PasswordSetup {
  return {
    sendCode: (input, view) => sendCode(authenticator, input, view),
    resend: (input, view) => resend(authenticator, input, view),
    verifyCode: (input, view) => verifyCode(authenticator, input, view),
    setPassword: (input, view) =>
      setPassword(authenticator, navigation, input, view),
  };
}

// 登録済みのメールアドレスには、コードを送らない。
async function sendCode(
  authenticator: SignUpAuthenticator,
  input: { email: string },
  view: PasswordSetupView,
) {
  const ready = begin(checkSendCode(view.state, input), view, "send");
  if (!ready) return;
  const registration = await authenticator.isRegistered(ready.email);
  // 送信中に画面を離れたときは、状態を変えず、チェックのやり直しもしない。
  if (!view.isMounted()) return;
  // 登録済みの判定と、判定の失敗は、トークンを使っていないので消費しない。
  if (registration.kind !== "unregistered") {
    const failure: AuthFailure =
      registration.kind === "registered"
        ? { kind: "already_registered" }
        : UNREACHABLE;
    view.dispatch({ type: "failed", failure });
    return;
  }
  await deliver(authenticator, ready, view, { type: "codeSent" });
}

// 設定に成功したら、ラウンド一覧へ遷移する。遷移が投げたときは、通信エラーとして失敗にし、実行中のまま止めない。
async function setPassword(
  authenticator: SignUpAuthenticator,
  navigation: Pick<Navigation, "go">,
  input: { password: string },
  view: PasswordSetupView,
) {
  if (!(await applyPassword(authenticator, input, view))) return;
  try {
    navigation.go(destinationOf(null));
  } catch {
    view.dispatch({ type: "failed", failure: UNREACHABLE });
  }
}
