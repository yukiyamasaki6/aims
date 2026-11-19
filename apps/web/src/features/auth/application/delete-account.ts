import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import {
  beginDeleteAccount,
  beginDeleteCodeSend,
  beginDeleteCodeVerify,
  type DeleteAccountEvent,
  type DeleteAccountFlow,
} from "../domain/delete-account-flow";
import type { EmailOtpAuthenticator } from "./email-otp";
import type { ScreenView } from "./screen-view";
import type { SessionEndHold, SessionReader } from "./session";

export type CurrentAccountResult =
  | { kind: "current"; userId: string; email: string }
  | { kind: "failed"; failure: AuthFailure }
  | { kind: "lost" };
export type DeleteAccountAuthenticator = SessionReader &
  EmailOtpAuthenticator & {
    readCurrentAccount(): Promise<CurrentAccountResult>;
  };
export type AccountDeletionResult =
  | { kind: "deleted" }
  | { kind: "failed"; failure: AuthFailure };
export type AccountDeletion = {
  delete(expectedUserId: string): Promise<AccountDeletionResult>;
};
export type LocalRecordsEraser = { erase(userId: string): Promise<void> };
type View = ScreenView<DeleteAccountFlow, DeleteAccountEvent>;
export type DeleteAccount = {
  submit(view: View): Promise<void>;
  sendCode(view: View): Promise<void>;
  verifyCode(input: { code: string }, view: View): Promise<void>;
  tickCooldown(dispatch: View["dispatch"]): () => void;
};
type Dependencies = {
  authenticator: DeleteAccountAuthenticator;
  account: AccountDeletion;
  eraser: LocalRecordsEraser;
  session: { holdEnd(): SessionEndHold | null };
  clock: Clock;
  connectivity: Pick<Connectivity, "isOffline">;
};

function showFailure(view: View, failure: AuthFailure, deletion = false) {
  if (!view.isMounted()) return;
  view.dispatch({ type: deletion ? "deletionFailed" : "failed", failure });
  view.resetCheck();
}

async function currentAccount(authenticator: DeleteAccountAuthenticator) {
  const current = await authenticator.readCurrentAccount();
  if (current.kind === "lost")
    await authenticator.readSession({ refresh: true });
  return current;
}

async function finish(
  eraser: LocalRecordsEraser,
  hold: SessionEndHold,
  view: View,
  userId: string,
) {
  try {
    await eraser.erase(userId);
  } catch {
    /* 削除済みの利用者の記録は表示も送信もされない。 */
  }
  const ended = await hold.complete();
  if (ended.kind === "failed") {
    showFailure(view, UNREACHABLE, true);
    await hold.release();
  }
}

async function deleteCurrent(
  dependencies: Dependencies,
  current: { userId: string; email: string },
  hold: SessionEndHold,
  view: View,
) {
  const result = await dependencies.account.delete(current.userId);
  if (!hold.isActive()) return;
  hold.disarm();
  if (result.kind === "deleted")
    return finish(dependencies.eraser, hold, view, current.userId);
  if (result.failure.kind === "otp_required" && view.isMounted()) {
    view.dispatch({ type: "otpRequired", ...current });
    view.resetCheck();
  } else showFailure(view, result.failure, true);
  await hold.release();
}

async function withHold(
  dependencies: Dependencies,
  view: View,
  run: (hold: SessionEndHold) => Promise<void>,
) {
  const hold = dependencies.session.holdEnd();
  if (!hold) {
    showFailure(view, UNREACHABLE, true);
    return;
  }
  await Promise.race([
    run(hold),
    hold.expired.then(() => showFailure(view, UNREACHABLE, true)),
  ]);
}

async function sendCode(
  { authenticator, connectivity }: Dependencies,
  view: View,
) {
  const request = view.begin((flow) =>
    beginDeleteCodeSend(flow, connectivity.isOffline()),
  );
  if (!request) return;
  const current = await currentAccount(authenticator);
  if (!view.isMounted()) return;
  if (
    current.kind !== "current" ||
    current.userId !== request.userId ||
    current.email !== request.email
  ) {
    showFailure(
      view,
      current.kind === "failed" ? current.failure : { kind: "other" },
      true,
    );
    return;
  }
  const result = await authenticator.sendCode({
    ...request,
    shouldCreateUser: false,
  });
  if (!view.isMounted()) return;
  view.dispatch(
    result.kind === "accepted"
      ? { type: "codeSent" }
      : { type: "refused", failure: result.failure },
  );
  view.resetCheck();
}

async function confirmAndDelete(
  dependencies: Dependencies,
  request: { userId: string; email: string; code: string },
  hold: SessionEndHold,
  view: View,
) {
  const current = await currentAccount(dependencies.authenticator);
  if (!hold.isActive()) return;
  if (
    current.kind !== "current" ||
    current.userId !== request.userId ||
    current.email !== request.email
  ) {
    showFailure(
      view,
      current.kind === "failed" ? current.failure : { kind: "other" },
      true,
    );
    await hold.release();
    return;
  }
  const result = await dependencies.authenticator.verifyCode(request);
  if (!hold.isActive()) return;
  if (result.kind === "failed" || result.userId !== request.userId) {
    showFailure(
      view,
      result.kind === "failed" ? result.failure : { kind: "other" },
      result.kind !== "failed",
    );
    await hold.release();
    return;
  }
  const after = await currentAccount(dependencies.authenticator);
  if (!hold.isActive()) return;
  if (
    after.kind !== "current" ||
    after.userId !== request.userId ||
    after.email !== request.email
  ) {
    showFailure(
      view,
      after.kind === "failed" ? after.failure : { kind: "other" },
      true,
    );
    await hold.release();
    return;
  }
  await deleteCurrent(dependencies, after, hold, view);
}

export function createDeleteAccount(dependencies: Dependencies): DeleteAccount {
  const { authenticator, connectivity, clock } = dependencies;
  return {
    async submit(view) {
      if (
        !view.begin((flow) =>
          beginDeleteAccount(flow, { offline: connectivity.isOffline() }),
        )
      )
        return;
      const current = await currentAccount(authenticator);
      if (!view.isMounted()) return;
      if (current.kind !== "current") {
        showFailure(
          view,
          current.kind === "failed" ? current.failure : UNREACHABLE,
          true,
        );
        return;
      }
      view.dispatch({
        type: "codeRequested",
        userId: current.userId,
        email: current.email,
      });
    },
    sendCode: (view) => sendCode(dependencies, view),
    async verifyCode(input, view) {
      const request = view.begin((flow) =>
        beginDeleteCodeVerify(flow, {
          ...input,
          offline: connectivity.isOffline(),
        }),
      );
      if (!request) return;
      await withHold(dependencies, view, (hold) =>
        confirmAndDelete(dependencies, request, hold, view),
      );
    },
    tickCooldown: (dispatch) =>
      clock.after(1000, () => dispatch({ type: "cooldownTicked" })),
  };
}
