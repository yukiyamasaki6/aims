import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import {
  beginDeleteCodeSend,
  beginDeleteCodeVerify,
  type DeleteAccountEvent,
  type DeleteAccountFlow,
} from "../domain/delete-account-flow";
import {
  type CooldownTick,
  deliverCode,
  type EmailOtpAuthenticator,
  tickResendCooldown,
} from "./email-otp";
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
export type AccountDeletionResult = { kind: "deleted" } | { kind: "failed" };
export type AccountDeletion = {
  delete(expectedUserId: string): Promise<AccountDeletionResult>;
};
export type LocalRecordsEraser = { erase(userId: string): Promise<void> };
type View = ScreenView<DeleteAccountFlow, DeleteAccountEvent>;
export type DeleteAccount = {
  sendCode(view: View): Promise<void>;
  verifyCode(input: { code: string }, view: View): Promise<void>;
  tickCooldown: CooldownTick;
};
type Dependencies = {
  authenticator: DeleteAccountAuthenticator;
  account: AccountDeletion;
  eraser: LocalRecordsEraser;
  session: { holdEnd(): SessionEndHold | null };
  clock: Clock;
  connectivity: Pick<Connectivity, "isOffline">;
};

function settle(view: View, event: DeleteAccountEvent) {
  if (!view.isMounted()) return;
  view.dispatch(event);
  view.resetCheck();
}

function showFailure(view: View, failure: AuthFailure) {
  settle(view, { type: "failed", failure });
}

// コード確認に成功した後の失敗。意思確認へ戻す。
function returnWithFailure(view: View) {
  settle(view, { type: "returnedWithFailure" });
}

async function currentAccount(authenticator: DeleteAccountAuthenticator) {
  const current = await authenticator.readCurrentAccount();
  if (current.kind === "lost")
    await authenticator.readSession({ refresh: true });
  return current;
}

type Account = { userId: string; email: string };

function isSame(current: CurrentAccountResult, target: Account) {
  return (
    current.kind === "current" &&
    current.userId === target.userId &&
    current.email === target.email
  );
}

function accountFailure(current: CurrentAccountResult): AuthFailure {
  return current.kind === "failed" ? current.failure : { kind: "other" };
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
    showFailure(view, UNREACHABLE);
    await hold.release();
  }
}

async function deleteCurrent(
  dependencies: Dependencies,
  userId: string,
  hold: SessionEndHold,
  view: View,
) {
  const result = await dependencies.account.delete(userId);
  if (!hold.isActive()) return;
  hold.disarm();
  if (result.kind === "deleted")
    return finish(dependencies.eraser, hold, view, userId);
  returnWithFailure(view);
  await hold.release();
}

async function withHold(
  dependencies: Dependencies,
  view: View,
  run: (hold: SessionEndHold) => Promise<void>,
) {
  const hold = dependencies.session.holdEnd();
  if (!hold) {
    showFailure(view, UNREACHABLE);
    return;
  }
  await Promise.race([
    run(hold),
    hold.expired.then(() => showFailure(view, UNREACHABLE)),
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
    (request.known && !isSame(current, request.known))
  ) {
    showFailure(view, accountFailure(current));
    return;
  }
  await deliverCode(
    authenticator,
    view,
    {
      email: current.email,
      captchaToken: request.captchaToken,
      shouldCreateUser: false,
    },
    { type: "codeSentTo", userId: current.userId, email: current.email },
  );
}

async function confirmAndDelete(
  dependencies: Dependencies,
  request: Account & { code: string },
  hold: SessionEndHold,
  view: View,
) {
  const current = await currentAccount(dependencies.authenticator);
  if (!hold.isActive()) return;
  if (!isSame(current, request)) {
    showFailure(view, accountFailure(current));
    await hold.release();
    return;
  }
  const result = await dependencies.authenticator.verifyCode(request);
  if (!hold.isActive()) return;
  if (result.kind === "failed") {
    showFailure(view, result.failure);
    await hold.release();
    return;
  }
  const after = await currentAccount(dependencies.authenticator);
  if (!hold.isActive()) return;
  if (!isSame(after, request)) {
    returnWithFailure(view);
    await hold.release();
    return;
  }
  await deleteCurrent(dependencies, request.userId, hold, view);
}

export function createDeleteAccount(dependencies: Dependencies): DeleteAccount {
  const { connectivity, clock } = dependencies;
  return {
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
    tickCooldown: tickResendCooldown(clock),
  };
}
