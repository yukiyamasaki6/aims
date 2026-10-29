import type { IdentityReader, SignInChanges } from "@/features/auth";
import type { SignInSignals } from "../application/sync-triggers";

// 認証の入口の通知を、同期の約束で包む。認証の変化は、ここで1本だけ購読する。
export function createAuthSignInSignals(deps: {
  changes: SignInChanges;
  identityReader: IdentityReader;
}): SignInSignals {
  return {
    initialUserId: () => deps.identityReader.read(),
    subscribe: (listener) => deps.changes.subscribe(listener),
  };
}
