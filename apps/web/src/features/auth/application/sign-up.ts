import type { AuthFailure } from "../domain/auth-failure";
import { destinationOf } from "../domain/return-to";
import {
  type Check,
  checkResend,
  checkSendCode,
  checkSetPassword,
  checkVerifyCode,
  type SignUpEvent,
  type SignUpFlow,
} from "../domain/sign-up-flow";
import type { Navigation } from "./navigation";
import type { ScreenView } from "./screen-view";

// 認証サービスが応答しなかった(接続を得られない、呼び出しが投げた)こと。送ったセキュリティチェックのトークンは使われていない。
type Unreached = { readonly kind: "unreached" };
export type Registration =
  | { readonly kind: "registered" }
  | { readonly kind: "unregistered" }
  | Unreached;
export type Delivery =
  | { readonly kind: "sent" }
  | { readonly kind: "refused"; readonly failure: AuthFailure }
  | Unreached;

// 認証サービスに頼むこと。どれも例外を投げず、失敗は値で返す。
export type SignUpAuthenticator = {
  isRegistered(email: string): Promise<Registration>;
  sendCode(request: { email: string; captchaToken: string }): Promise<Delivery>;
  verifyCode(request: {
    email: string;
    code: string;
  }): Promise<AuthFailure | null>;
  setPassword(password: string): Promise<AuthFailure | null>;
};

type View = ScreenView<SignUpFlow, SignUpEvent>;

type Dependencies = {
  authenticator: SignUpAuthenticator;
  navigation: Pick<Navigation, "go">;
};

export type SignUp = {
  sendCode(input: { email: string }, view: View): Promise<void>;
  resend(input: { email: string }, view: View): Promise<void>;
  verifyCode(input: { email: string; code: string }, view: View): Promise<void>;
  setPassword(input: { password: string }, view: View): Promise<void>;
};

export function createSignUp(deps: Dependencies): SignUp {
  return {
    sendCode: (input, view) => sendCode(deps, input, view),
    resend: (input, view) => resend(deps, input, view),
    verifyCode: (input, view) => verifyCode(deps, input, view),
    setPassword: (input, view) => setPassword(deps, input, view),
  };
}

const UNREACHABLE: AuthFailure = { kind: "unreachable" };

// 操作を始められるかを判定し、始められるなら実行中にして、判定の結果を返す。
// 実行中なら何もせず、入力の不備なら示して、nullを返す。
function begin<Ready extends object>(
  check: Check<Ready>,
  view: View,
  operation: Extract<SignUpEvent, { type: "started" }>["operation"],
): Ready | null {
  if (check.kind === "busy") return null;
  if (check.kind === "invalid") {
    view.dispatch({ type: "invalid", fieldErrors: check.fieldErrors });
    return null;
  }
  view.dispatch({ type: "started", operation });
  return check;
}

async function sendCode(
  { authenticator }: Dependencies,
  input: { email: string },
  view: View,
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

async function resend(
  { authenticator }: Dependencies,
  input: { email: string },
  view: View,
) {
  const ready = begin(checkResend(view.state, input), view, "resend");
  if (!ready) return;
  await deliver(authenticator, ready, view, { type: "codeResent" });
}

// コードの送信の依頼。応答があれば、成功でも拒否でも、使ったトークンは消費し、チェックをやり直させる。
async function deliver(
  authenticator: SignUpAuthenticator,
  { email, captchaToken }: { email: string; captchaToken: string },
  view: View,
  sent: Extract<SignUpEvent, { type: "codeSent" | "codeResent" }>,
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

async function verifyCode(
  { authenticator }: Dependencies,
  input: { email: string; code: string },
  view: View,
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

async function setPassword(
  { authenticator, navigation }: Dependencies,
  input: { password: string },
  view: View,
) {
  const ready = begin(checkSetPassword(view.state, input), view, "setPassword");
  if (!ready) return;
  const failure = await authenticator.setPassword(ready.password);
  if (!view.isMounted()) return;
  if (failure) {
    view.dispatch({ type: "failed", failure });
    return;
  }
  // 成功時は実行中を解除しない。遷移が終わる前に再び押され、二重に登録されるのを防ぐため。
  // 遷移が投げたときは、通信エラーとして失敗にし、実行中のまま止めない。
  try {
    navigation.go(destinationOf(null));
  } catch {
    view.dispatch({ type: "failed", failure: UNREACHABLE });
  }
}
