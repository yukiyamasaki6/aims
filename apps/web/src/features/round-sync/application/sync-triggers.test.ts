import { describe, expect, it, vi } from "vitest";
import type {
  SignInChange as AuthSignInChange,
  IdentityReader,
  SignInChanges,
} from "@/features/auth";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { RoundSync } from "./round-sync";
import { createSyncTriggers, type Visibility } from "./sync-triggers";

type Match = "same" | "other" | "unowned";

// 契機の受け取りは、受けた契機を同期の手続きの操作に変える。通知の源、同期の手続きは約束で差し替える。
function setup(initialUserId: string | null = "user-1") {
  const signIn = new Set<(change: AuthSignInChange) => void>();
  const online = new Set<() => void>();
  const offline = new Set<() => void>();
  const visible = new Set<() => void>();
  const match = { current: "same" as Match };
  const changes: SignInChanges = {
    subscribe: vi.fn((listener) => {
      signIn.add(listener);
      return () => signIn.delete(listener);
    }),
  };
  const identityReader: IdentityReader = { read: () => initialUserId };
  const visibility: Visibility = {
    onVisible: vi.fn((listener) => {
      visible.add(listener);
      return () => visible.delete(listener);
    }),
  };
  const connectivity: Connectivity = {
    isOffline: () => false,
    onOnline: vi.fn((listener) => {
      online.add(listener);
      return () => online.delete(listener);
    }),
    onOffline: vi.fn((listener) => {
      offline.add(listener);
      return () => offline.delete(listener);
    }),
  };
  const sync = {
    start: vi.fn(),
    stop: vi.fn(),
    switchUser: vi.fn(),
    resume: vi.fn(),
    refreshAll: vi.fn(),
    online: vi.fn(),
    offline: vi.fn(),
    visible: vi.fn(),
    matchUser: vi.fn(() => match.current),
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
    match,
    changes,
    connectivity,
    emitSignIn: (change: AuthSignInChange) => {
      for (const listener of [...signIn]) listener(change);
    },
    fire: {
      online: () => {
        for (const listener of [...online]) listener();
      },
      offline: () => {
        for (const listener of [...offline]) listener();
      },
      visible: () => {
        for (const listener of [...visible]) listener();
      },
    },
    counts: () => ({
      signIn: signIn.size,
      online: online.size,
      offline: offline.size,
      visible: visible.size,
    }),
  };
}

describe("認証の通知", () => {
  // 通知の種類と照合の結果ごとの反応(要求の表)。反応と、一括の取得を始めるかを、同期の操作で観測する。
  it.each([
    ["signed-in", "same", "resume", true],
    ["signed-in", "other", "switchUser", true],
    ["signed-in", "unowned", "switchUser", true],
    ["initial", "same", "resume", true],
    ["initial", "other", "switchUser", true],
    ["initial", "unowned", "switchUser", true],
    ["token-refreshed", "same", "resume", false],
    ["token-refreshed", "other", "switchUser", false],
    ["token-refreshed", "unowned", "switchUser", false],
  ] as const)(
    "利用者のある%sの通知で照合が%sなら、%sに反応し、一括の取得の開始は%sになる",
    (kind, match, reaction, starts) => {
      // Given
      const t = setup();
      t.triggers.start();
      t.match.current = match;

      // When
      t.emitSignIn({ kind, userId: "user-9" });

      // Then
      expect(t.sync.resume).toHaveBeenCalledTimes(
        reaction === "resume" ? 1 : 0,
      );
      expect(t.sync.switchUser).toHaveBeenCalledTimes(
        reaction === "switchUser" ? 1 : 0,
      );
      if (reaction === "switchUser") {
        expect(t.sync.switchUser).toHaveBeenCalledWith("user-9");
      }
      expect(t.sync.refreshAll).toHaveBeenCalledTimes(starts ? 1 : 0);
      expect(t.sync.matchUser).toHaveBeenCalledWith("user-9");
    },
  );

  it("signed-outは、利用者を外し、一括の取得は始めない", () => {
    // Given
    const t = setup();
    t.triggers.start();

    // When
    t.emitSignIn({ kind: "signed-out", userId: null });

    // Then
    expect(t.sync.switchUser).toHaveBeenCalledExactlyOnceWith(null);
    expect(t.sync.refreshAll).not.toHaveBeenCalled();
  });

  it("利用者のないinitialと、利用者のないtoken-refreshed、otherは、何もしない", () => {
    // Given
    const t = setup();
    t.triggers.start();

    // When
    t.emitSignIn({ kind: "initial", userId: null });
    t.emitSignIn({ kind: "token-refreshed", userId: null });
    t.emitSignIn({ kind: "other", userId: null });

    // Then
    expect(t.sync.switchUser).not.toHaveBeenCalled();
    expect(t.sync.resume).not.toHaveBeenCalled();
    expect(t.sync.refreshAll).not.toHaveBeenCalled();
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

  it("通信の復帰はonline、切断はoffline、見える状態はvisibleにする", () => {
    // Given
    const t = setup();
    t.triggers.start();

    // When
    t.fire.online();
    t.fire.offline();
    t.fire.visible();

    // Then
    expect(t.sync.online).toHaveBeenCalledTimes(1);
    expect(t.sync.offline).toHaveBeenCalledTimes(1);
    expect(t.sync.visible).toHaveBeenCalledTimes(1);
  });

  it("通信の復帰と見える状態は、1か所の購読だけで受ける(重複の解消)", () => {
    // Given
    const t = setup();

    // When
    t.triggers.start();

    // Then
    // 購読の本数は、要求である「1か所で受ける」を観測するため、例外的に回数で確かめる。
    expect(t.connectivity.onOnline).toHaveBeenCalledTimes(1);
    expect(t.connectivity.onOffline).toHaveBeenCalledTimes(1);
    expect(t.changes.subscribe).toHaveBeenCalledTimes(1);
    expect(t.counts()).toEqual({
      signIn: 1,
      online: 1,
      offline: 1,
      visible: 1,
    });
  });

  it("停止で購読を全て解除し、同期を止める。停止の後に来た通知では何も呼ばない", () => {
    // Given
    const t = setup();
    const stop = t.triggers.start();

    // When
    stop();
    t.emitSignIn({ kind: "signed-in", userId: "user-1" });
    t.fire.online();
    t.fire.offline();
    t.fire.visible();

    // Then
    expect(t.counts()).toEqual({
      signIn: 0,
      online: 0,
      offline: 0,
      visible: 0,
    });
    expect(t.sync.stop).toHaveBeenCalledTimes(1);
    expect(t.sync.online).not.toHaveBeenCalled();
    expect(t.sync.refreshAll).not.toHaveBeenCalled();
  });
});
