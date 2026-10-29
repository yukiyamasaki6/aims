import { describe, expect, it, vi } from "vitest";
import type {
  IdentityReader,
  SignInChange,
  SignInChanges,
} from "@/features/auth";
import { createAuthSignInSignals } from "./auth-sign-in-signals";

// 認証の入口の通知と、端末の識別情報の読み手を、約束で差し替える。
function setup(userId: string | null = "user-1") {
  const listeners = new Set<(change: SignInChange) => void>();
  const changes: SignInChanges = {
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  const identityReader: IdentityReader = { read: () => userId };
  const signals = createAuthSignInSignals({ changes, identityReader });
  return {
    signals,
    changes,
    emit: (change: SignInChange) => {
      for (const listener of [...listeners]) listener(change);
    },
    subscribed: () => listeners.size,
  };
}

describe("createAuthSignInSignals", () => {
  it("認証の入口の通知を1本だけ購読し、通知を平らな値のまま渡す", () => {
    // Given
    const t = setup();
    const received: SignInChange[] = [];
    t.signals.subscribe((change) => received.push(change));

    // When
    t.emit({ kind: "signed-in", userId: "user-1" });
    t.emit({ kind: "token-refreshed", userId: "user-1" });
    t.emit({ kind: "signed-out", userId: null });

    // Then
    expect(t.changes.subscribe).toHaveBeenCalledTimes(1);
    expect(received).toEqual([
      { kind: "signed-in", userId: "user-1" },
      { kind: "token-refreshed", userId: "user-1" },
      { kind: "signed-out", userId: null },
    ]);
  });

  it("解除で購読を外す", () => {
    // Given
    const t = setup();
    const stop = t.signals.subscribe(() => {});

    // When
    stop();

    // Then
    expect(t.subscribed()).toBe(0);
  });

  it("initialUserIdは、端末の識別情報の利用者を返す。無ければnullを返す", () => {
    // Given
    const signedIn = setup("user-1");
    const signedOut = setup(null);

    // When
    const first = signedIn.signals.initialUserId();
    const second = signedOut.signals.initialUserId();

    // Then
    expect(first).toBe("user-1");
    expect(second).toBeNull();
  });
});
