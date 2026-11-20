import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { AuthFailure } from "../domain/auth-failure";
import {
  beginConfirmEmailChange,
  beginRequestEmailChange,
  beginResendEmailChangeCode,
  type ChangeEmailEvent,
  type ChangeEmailFlow,
  type CodeField,
} from "../domain/change-email-flow";
import { type CallResult, failureOf } from "./call-result";
import { type CooldownTick, tickResendCooldown } from "./email-otp";
import type { ScreenView } from "./screen-view";

// 認証サービスに、サインイン済みの利用者のメールアドレスを、現在と新しいメールアドレスの2つの認証コードで変更させる。
// 例外は投げず、結果は値で返す。二重の確認は認証サービスが行う。
export type ChangeEmailAuthenticator = {
  // 現在のメールアドレスを、端末のセッションから読む。読めないときはnull。
  readCurrentEmail(): Promise<string | null>;
  // 変更を要求する。受け付けられたときは、応答の現在のメールアドレスを持つ。
  requestEmailChange(request: {
    newEmail: string;
  }): Promise<EmailChangeRequestResult>;
  // 欄のコードを、その欄のメールアドレスを付けて確認する。
  confirmEmailChange(request: {
    email: string;
    code: string;
  }): Promise<EmailChangeConfirmResult>;
  // 認証コードを再送する。emailは現在のメールアドレスで、両方のアドレスへ新しいコードが届く。
  resendEmailChangeCode(request: {
    email: string;
    captchaToken: string;
  }): Promise<CallResult>;
};

type Failed = { readonly kind: "failed"; readonly failure: AuthFailure };

export type EmailChangeRequestResult =
  | { readonly kind: "accepted"; readonly currentEmail: string }
  | Failed;

// partial: 一方だけの確認が済んだ。completed: 両方が済み、変更が完了した。
export type EmailChangeConfirmResult =
  | { readonly kind: "partial" }
  | { readonly kind: "completed" }
  | Failed;

export type ChangeEmailView = ScreenView<ChangeEmailFlow, ChangeEmailEvent>;

// 画面が呼ぶ操作。
export type ChangeEmail = {
  load(view: Pick<ChangeEmailView, "dispatch" | "isMounted">): Promise<void>;
  request(input: { email: string }, view: ChangeEmailView): Promise<void>;
  confirm(
    input: { codes: { readonly [F in CodeField]: string } },
    view: ChangeEmailView,
  ): Promise<void>;
  resend(view: ChangeEmailView): Promise<void>;
  // 再送の待ちを1秒進める出来事を、1秒後に1回送る予約。返す関数で取り消す。
  tickCooldown: CooldownTick;
};

type Dependencies = {
  authenticator: ChangeEmailAuthenticator;
  connectivity: Pick<Connectivity, "isOffline">;
};

export function createChangeEmail({
  authenticator,
  connectivity,
  clock,
}: Dependencies & {
  clock: Clock;
}): ChangeEmail {
  const dependencies = { authenticator, connectivity };
  return {
    load: (view) => load(dependencies, view),
    request: (input, view) => request(dependencies, input, view),
    confirm: (input, view) => confirm(dependencies, input, view),
    resend: (view) => resend(dependencies, view),
    tickCooldown: tickResendCooldown(clock),
  };
}

// 現在のメールアドレスは表示だけに使う。読めなければ何もしない。
async function load(
  { authenticator }: Dependencies,
  view: Pick<ChangeEmailView, "dispatch" | "isMounted">,
) {
  const email = await authenticator.readCurrentEmail();
  if (email === null || !view.isMounted()) return;
  view.dispatch({ type: "currentEmailLoaded", email });
}

// 各操作は、送信の直前にオフラインを1回読み(購読しない)、判定は集約が行う。
// 応答の後、画面が表示中のときだけ状態を更新する。呼び出しは取り消さない。
async function request(
  { authenticator, connectivity }: Dependencies,
  input: { email: string },
  view: ChangeEmailView,
) {
  const offline = connectivity.isOffline();
  const started = view.begin((flow) =>
    beginRequestEmailChange(flow, { ...input, offline }),
  );
  if (!started) return;
  const result = await authenticator.requestEmailChange(started);
  if (!view.isMounted()) return;
  view.dispatch(
    result.kind === "accepted"
      ? {
          type: "requested",
          currentEmail: result.currentEmail,
          newEmail: started.newEmail,
        }
      : { type: "failed", failure: result.failure },
  );
}

// 値を変えた欄を、変更前、変更後の順に1回ずつ確認する。
// 片方が失敗しても、もう一方も確認する。完了したら、以降は確認しない。
// 誤りまたは期限切れは、その欄の誤りとして、それ以外の失敗は最初の1つだけを、1つの事実にまとめる。
// 離れた後も、残りの確認は進める。画面が表示中のときだけ反映する。
async function confirm(
  { authenticator, connectivity }: Dependencies,
  input: { codes: { readonly [F in CodeField]: string } },
  view: ChangeEmailView,
) {
  const offline = connectivity.isOffline();
  const started = view.begin((flow) =>
    beginConfirmEmailChange(flow, { ...input, offline }),
  );
  if (!started) return;
  const confirmed: { field: CodeField; code: string }[] = [];
  const expired: CodeField[] = [];
  let completed = false;
  let failure: AuthFailure | null = null;
  for (const { field, email, code } of started) {
    const result = await authenticator.confirmEmailChange({ email, code });
    if (result.kind !== "failed") confirmed.push({ field, code });
    else if (result.failure.kind === "code_expired") expired.push(field);
    else failure ??= result.failure;
    if (result.kind === "completed") {
      completed = true;
      break;
    }
  }
  if (!view.isMounted()) return;
  view.dispatch({ type: "confirmed", confirmed, expired, completed, failure });
}

// 成功でも失敗でも、トークンは消費し、チェックをやり直させる。
async function resend(
  { authenticator, connectivity }: Dependencies,
  view: ChangeEmailView,
) {
  const offline = connectivity.isOffline();
  const started = view.begin((flow) =>
    beginResendEmailChangeCode(flow, { offline }),
  );
  if (!started) return;
  const result = await authenticator.resendEmailChangeCode(started);
  if (!view.isMounted()) return;
  const failure = failureOf(result);
  view.dispatch(failure ? { type: "refused", failure } : { type: "resent" });
  view.resetCheck();
}
