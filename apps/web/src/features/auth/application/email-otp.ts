import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { AuthFailure } from "../domain/auth-failure";
import {
  beginSendCode,
  beginVerifyCode,
  type EmailOtpEvent,
  type EmailOtpFlow,
} from "../domain/email-otp-flow";
import type { CallResult } from "./call-result";
import type { ScreenView } from "./screen-view";

export type CodeVerification =
  | { kind: "verified" }
  | Extract<CallResult, { kind: "failed" }>;
export type EmailOtpAuthenticator = {
  sendCode(request: {
    email: string;
    captchaToken: string;
    shouldCreateUser: boolean;
  }): Promise<CallResult>;
  verifyCode(request: {
    email: string;
    code: string;
  }): Promise<CodeVerification>;
};
type EmailOtpView = ScreenView<EmailOtpFlow, EmailOtpEvent>;

// 再送待機の1秒を進める計時を、画面の約束へ予約する。予約の取り消しを返す。
export type CooldownTick = (
  dispatch: (event: { type: "cooldownTicked" }) => void,
) => () => void;

export function tickResendCooldown(clock: Clock): CooldownTick {
  return (dispatch) =>
    clock.after(1000, () => dispatch({ type: "cooldownTicked" }));
}

// コードを送り、画面が表示中なら結果を反映してチェックをやり直す。受け付けられて表示中のときだけtrue。
export async function deliverCode<Sent>(
  authenticator: Pick<EmailOtpAuthenticator, "sendCode">,
  view: Pick<
    ScreenView<unknown, Sent | { type: "refused"; failure: AuthFailure }>,
    "isMounted" | "dispatch" | "resetCheck"
  >,
  request: { email: string; captchaToken: string; shouldCreateUser: boolean },
  sent: Sent,
): Promise<boolean> {
  const result = await authenticator.sendCode(request);
  if (!view.isMounted()) return false;
  view.dispatch(
    result.kind === "accepted"
      ? sent
      : { type: "refused", failure: result.failure },
  );
  view.resetCheck();
  return result.kind === "accepted";
}

export type EmailOtp = {
  sendCode(
    input: { email: string; from?: string | null },
    view: EmailOtpView,
  ): Promise<void>;
  verifyCode(
    input: { email: string; code: string },
    view: EmailOtpView,
  ): Promise<void>;
  tickCooldown: CooldownTick;
};
export type EmailOtpDependencies = {
  authenticator: EmailOtpAuthenticator;
  clock: Clock;
  connectivity: Pick<Connectivity, "isOffline">;
};

export function createEmailOtp({
  authenticator,
  clock,
  connectivity,
  shouldCreateUser,
  complete,
}: EmailOtpDependencies & {
  shouldCreateUser: boolean;
  complete(from: string | null): void;
}): EmailOtp {
  let destination: string | null = null;
  let sentEmail: string | null = null;
  return {
    async sendCode(input, view) {
      const request = view.begin((flow) =>
        beginSendCode(flow, { ...input, offline: connectivity.isOffline() }),
      );
      if (!request) return;
      const accepted = await deliverCode(
        authenticator,
        view,
        { ...request, shouldCreateUser },
        { type: "codeSent" },
      );
      if (!accepted) return;
      sentEmail = request.email;
      if (input.from !== undefined) destination = input.from;
    },
    async verifyCode(input, view) {
      const request = view.begin((flow) =>
        beginVerifyCode(flow, { ...input, offline: connectivity.isOffline() }),
      );
      if (!request) return;
      if (request.email !== sentEmail) {
        view.dispatch({ type: "failed", failure: { kind: "other" } });
        return;
      }
      const result = await authenticator.verifyCode(request);
      if (!view.isMounted()) return;
      if (result.kind === "failed")
        view.dispatch({ type: "failed", failure: result.failure });
      else complete(destination);
    },
    tickCooldown: tickResendCooldown(clock),
  };
}
