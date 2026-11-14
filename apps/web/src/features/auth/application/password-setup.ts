import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  beginSendCode,
  beginSetPassword,
  beginVerifyCode,
  type PasswordSetupEvent,
  type PasswordSetupFlow,
  type SetPasswordRequest,
} from "../domain/password-setup-flow";
import { type CallResult, failureOf } from "./call-result";
import type {
  CodePurpose,
  PasswordSetupAuthenticator,
} from "./password-setup-authenticator";
import type { ScreenView } from "./screen-view";

// 認証コードで本人確認をして、パスワードを設定する手続き(サインアップとパスワード再設定)が共有する順序。
// 手続きごとに違うのは、コードの目的と、パスワード設定の後の動作で、それぞれの手続きのファイルが持つ。

export type PasswordSetupView = ScreenView<
  PasswordSetupFlow,
  PasswordSetupEvent
>;

// 画面が呼ぶ操作。
export type PasswordSetup = {
  // パスワード設定の段階でも、セキュリティチェックを要するか。画面は、これが真のときだけウィジェットを描く。
  requiresCheck: boolean;
  sendCode(input: { email: string }, view: PasswordSetupView): Promise<void>;
  verifyCode(
    input: { email: string; code: string },
    view: PasswordSetupView,
  ): Promise<void>;
  // email: 設定の後のサインインに使う(サインアップだけが使う)。
  setPassword(
    input: { email: string; password: string },
    view: PasswordSetupView,
  ): Promise<void>;
  // 再送の待ちを1秒進める出来事を、1秒後に1回送る予約。返す関数で取り消す。
  tickCooldown(dispatch: PasswordSetupView["dispatch"]): () => void;
};

// 通信の可否のうち、送信の直前に読む部分。購読はしない。
type OfflineReader = Pick<Connectivity, "isOffline">;

// 共有の順序が使う、認証サービスと、手続きごとのコードの目的。
export type PasswordSetupContext = {
  authenticator: PasswordSetupAuthenticator;
  purpose: CodePurpose;
  clock: Clock;
  connectivity: OfflineReader;
  // パスワード設定の段階でもチェックを要するか。持ち主は手続きで、集約と画面へは、ここから渡す。
  requiresCheck: boolean;
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

// コードの送付の依頼(初回も再送も)。成功でも失敗でも、トークンは消費し、チェックをやり直させる。
// 再送の待ちは、送付の成功で始まる。失敗では始めない。
// 送信の直前にオフラインを1回読む。オフラインの判定は集約が行い、オフラインなら送らず、トークンも消費しない。
export async function sendCode(
  { authenticator, purpose, connectivity }: PasswordSetupContext,
  input: { email: string },
  view: PasswordSetupView,
) {
  const offline = connectivity.isOffline();
  const request = view.begin((flow) =>
    beginSendCode(flow, { ...input, offline }),
  );
  if (!request) return;
  const result = await authenticator.sendCode({ purpose, ...request });
  view.dispatch(
    result.kind === "accepted"
      ? { type: "codeSent" }
      : { type: "refused", failure: result.failure },
  );
  view.resetCheck();
}

export async function verifyCode(
  { authenticator, purpose, connectivity }: PasswordSetupContext,
  input: { email: string; code: string },
  view: PasswordSetupView,
) {
  const offline = connectivity.isOffline();
  const request = view.begin((flow) =>
    beginVerifyCode(flow, { ...input, offline }),
  );
  if (!request) return;
  const result = await authenticator.verifyCode({ purpose, ...request });
  const failure = failureOf(result);
  view.dispatch(
    failure ? { type: "failed", failure } : { type: "codeConfirmed" },
  );
}

// パスワード設定の依頼の結果。
// result: 設定の結果(受け付けられた、または失敗)。
// mounted: 応答の後も画面が表示中か。
// request: 開始の依頼(パスワードと、チェックを要するときのトークン)。設定の後のサインインに使う。
export type PasswordApplication = {
  result: CallResult;
  mounted: boolean;
  request: SetPasswordRequest;
};

// パスワードの設定の依頼。
// 開始できなかったとき(実行中、入力の不備、オフライン、チェック未完了)は、頼まずにnullを返す。
// 結果の扱いは呼び出し側が決める(失敗の表示、続きの動作)。成功しても実行中を解除しない。
// 続きの動作が終わる前に再び押され、二重に設定されるのを防ぐため。
export async function applyPassword(
  { authenticator, connectivity, requiresCheck }: PasswordSetupContext,
  input: { password: string },
  view: PasswordSetupView,
): Promise<PasswordApplication | null> {
  const offline = connectivity.isOffline();
  const request = view.begin((flow) =>
    beginSetPassword(flow, { ...input, offline, requiresCheck }),
  );
  if (!request) return null;
  const result = await authenticator.setPassword(request.password);
  return { result, mounted: view.isMounted(), request };
}
