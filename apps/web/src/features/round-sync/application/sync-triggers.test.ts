import { describe, expect, it, vi } from "vitest";
import type {
  IdentityReader,
  SignInChange,
  SignInChanges,
} from "@/features/auth";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { RoundSync } from "./round-sync";
import { createSyncTriggers, type Visibility } from "./sync-triggers";

// 契機の受け取りは、受けた契機を同期の手続きの操作に変える。通知の源、同期の手続きは約束で差し替える。
function setup(initialUserId: string | null = "user-1") {
  const signIn = new Set<(change: SignInChange) => void>();
  const online = new Set<() => void>();
  const visible = new Set<() => void>();
  const changes: SignInChanges = {
    subscribe: (listener) => {
      signIn.add(listener);
      return () => signIn.delete(listener);
    },
  };
  const identityReader: IdentityReader = { read: () => initialUserId };
  const visibility: Visibility = {
    onVisible: (listener) => {
      visible.add(listener);
      return () => visible.delete(listener);
    },
  };
  const connectivity: Connectivity = {
    isOffline: () => false,
    onOnline: (listener) => {
      online.add(listener);
      return () => online.delete(listener);
    },
  };
  const sync = {
    start: vi.fn(),
    stop: vi.fn(),
    signInChanged: vi.fn(),
    resume: vi.fn(),
  };
  const triggers = createSyncTriggers({
    identityReader,
    changes,
    visibility,
    connectivity,
    sync: sync as unknown as RoundSync,
  });
  return {
    triggers,
    sync,
    emitSignIn: (change: SignInChange) => {
      for (const listener of [...signIn]) listener(change);
    },
    fire: {
      online: () => {
        for (const listener of [...online]) listener();
      },
      visible: () => {
        for (const listener of [...visible]) listener();
      },
    },
    counts: () => ({
      signIn: signIn.size,
      online: online.size,
      visible: visible.size,
    }),
  };
}

describe("認証の通知", () => {
  // サインインの変化をそのまま同期へ渡す。取得は始めない(常駐の取得は同期の開始で1回頼む)。反応の規則はラウンド側が持つ。
  it.each([
    ["signed-in", { kind: "signed-in", userId: "user-9" }],
    ["signed-out", { kind: "signed-out" }],
  ] as const)("%sの通知は、そのまま同期へ渡す", (_name, change) => {
    // Given
    const t = setup();
    t.triggers.start();

    // When
    t.emitSignIn(change);

    // Then
    expect(t.sync.signInChanged).toHaveBeenCalledExactlyOnceWith(change);
    expect(t.sync.resume).not.toHaveBeenCalled();
  });
});

describe("通信と画面の状態", () => {
  it("開始で、端末の識別情報の利用者を渡して同期を始める", () => {
    // Given
    const t = setup("user-7");

    // When
    t.triggers.start();

    // Then
    expect(t.sync.start).toHaveBeenCalledExactlyOnceWith("user-7");
  });

  it("端末の識別情報が無いとき、開始は利用者をnullにして同期を始める", () => {
    // Given
    const t = setup(null);

    // When
    t.triggers.start();

    // Then
    expect(t.sync.start).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("通信の復帰と見える状態は、どちらもresumeにする(切断は購読しない)", () => {
    // Given
    const t = setup();
    t.triggers.start();

    // When
    t.fire.online();
    t.fire.visible();

    // Then
    expect(t.sync.resume).toHaveBeenCalledTimes(2);
  });

  it("停止で購読を全て解除し、同期を止める。停止の後に来た通知では何も呼ばない", () => {
    // Given
    const t = setup();
    const stop = t.triggers.start();

    // When
    stop();
    t.emitSignIn({ kind: "signed-in", userId: "user-1" });
    t.fire.online();
    t.fire.visible();

    // Then
    expect(t.counts()).toEqual({
      signIn: 0,
      online: 0,
      visible: 0,
    });
    expect(t.sync.stop).toHaveBeenCalledTimes(1);
    expect(t.sync.resume).not.toHaveBeenCalled();
    expect(t.sync.signInChanged).not.toHaveBeenCalled();
  });
});
