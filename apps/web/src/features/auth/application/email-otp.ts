import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  beginSendCode,
  beginVerifyCode,
  type EmailOtpEvent,
  type EmailOtpFlow,
} from "../domain/email-otp-flow";
import type { CallResult } from "./call-result";
import type { ScreenView } from "./screen-view";

export type CodeVerification =
  | { kind: "verified"; userId: string }
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
export type EmailOtpView = ScreenView<EmailOtpFlow, EmailOtpEvent>;
export type EmailOtp = {
  sendCode(
    input: { email: string; from?: string | null },
    view: EmailOtpView,
  ): Promise<void>;
  verifyCode(
    input: { email: string; code: string },
    view: EmailOtpView,
  ): Promise<void>;
  tickCooldown(dispatch: EmailOtpView["dispatch"]): () => void;
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
      const result = await authenticator.sendCode({
        ...request,
        shouldCreateUser,
      });
      if (!view.isMounted()) return;
      if (result.kind === "accepted") {
        sentEmail = request.email;
        if (input.from !== undefined) destination = input.from;
        view.dispatch({ type: "codeSent" });
      } else view.dispatch({ type: "refused", failure: result.failure });
      view.resetCheck();
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
    tickCooldown: (dispatch) =>
      clock.after(1000, () => dispatch({ type: "cooldownTicked" })),
  };
}
