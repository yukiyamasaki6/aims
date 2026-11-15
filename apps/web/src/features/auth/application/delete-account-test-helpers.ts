import { vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import type { SessionStatus } from "../domain/auth-change";
import type { SignInChange } from "./auth-changes";
import type { CallResult } from "./call-result";
import {
  type AccountDeletionResult,
  createDeleteAccount,
  type ReauthenticationResult,
} from "./delete-account";
import { createSession, type SessionReading } from "./session";

const accepted: CallResult = { kind: "accepted" };

// アカウント削除の手続きと、それが保持を取る実物のセッションを、境界(認証サービス、データベース、端末の消去、ページ遷移、時計、通信)の偽物で組む。
// 認証サービスの偽物は、サインインの状態(state.status)を持ち、この端末のサインインを終えると未認証にする。
// 既定は、再認証が成功(利用者"user-1")、削除が成功、消去が成功。
export function createDeleteAccountHarness({
  offline = false,
  here = "/settings/delete-account",
}: {
  offline?: boolean;
  here?: string;
} = {}) {
  const state: { status: SessionStatus } = { status: "authenticated" };
  const listeners: Array<(change: SignInChange) => void> = [];
  const readingOf = (): SessionReading =>
    state.status === "authenticated"
      ? { status: "authenticated", userId: "user-1" }
      : { status: state.status };
  const authenticator = {
    reauthenticate: vi.fn(
      async (_request: {
        password: string;
        captchaToken: string;
      }): Promise<ReauthenticationResult> => ({
        kind: "verified",
        userId: "user-1",
      }),
    ),
    readSession: vi.fn(async (_options?: { refresh?: boolean }) => readingOf()),
    signOutHere: vi.fn(async (): Promise<CallResult> => {
      state.status = "unauthenticated";
      return accepted;
    }),
    subscribe: vi.fn((listener: (change: SignInChange) => void) => {
      listeners.push(listener);
      return () => {
        listeners.splice(listeners.indexOf(listener), 1);
      };
    }),
  };
  const account = {
    delete: vi.fn(
      async (): Promise<AccountDeletionResult> => ({ kind: "deleted" }),
    ),
  };
  const eraser = { erase: vi.fn(async (_userId: string): Promise<void> => {}) };
  const clock = createManualClock();
  const connectivity = createFakeConnectivity(offline);
  const page = {
    here: vi.fn(() => here),
    replace: vi.fn<(to: string) => void>(),
  };
  // 端末に記録された最後の利用者。
  const recorded: { userId: string | null } = { userId: "user-1" };
  const session = createSession({
    clock,
    authenticator,
    pageReplace: page,
    recordUser: { isRecordUser: (userId: string) => userId === "user-1" },
    identity: {
      read: () => recorded.userId,
      write: (userId: string | null) => {
        recorded.userId = userId;
      },
    },
  });
  const deleteAccount = createDeleteAccount({
    authenticator,
    account,
    eraser,
    session,
    connectivity,
  });
  return {
    deleteAccount,
    session,
    authenticator,
    account,
    eraser,
    clock,
    connectivity,
    page,
    state,
    emit(change: SignInChange) {
      for (const listener of [...listeners]) listener(change);
    },
  };
}
