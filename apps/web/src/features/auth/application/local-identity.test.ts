import { describe, expect, it, vi } from "vitest";
import type { AccountSummary } from "../domain/account-summary";
import { createFakeAccountSummaryStore } from "./account-summary-store-test-helpers";
import type { SignInChange } from "./auth-changes";
import { createLocalIdentity } from "./local-identity";

const linked: AccountSummary = {
  userId: "user-1",
  email: "archer@example.test",
  google: { id: "identity-google", email: "archer@gmail.example.test" },
};

function setup() {
  const listeners: Array<(event: SignInChange) => void> = [];
  const unsubscribe = vi.fn();
  const writer = { write: vi.fn() };
  const summaries = createFakeAccountSummaryStore();
  const events = {
    subscribe: vi.fn((listener: (event: SignInChange) => void) => {
      listeners.push(listener);
      // 解除すると、実際にこのリスナーへ以降の出来事が届かなくなる。
      return () => {
        unsubscribe();
        listeners.splice(listeners.indexOf(listener), 1);
      };
    }),
  };
  const localIdentity = createLocalIdentity({
    changes: events,
    writer,
    summaries,
  });
  return {
    localIdentity,
    writer,
    summaries,
    events,
    unsubscribe,
    emit(event: SignInChange) {
      for (const listener of listeners) listener(event);
    },
  };
}

describe("端末の識別情報の記録", () => {
  it("サインインした利用者を記録する", () => {
    // Given
    const { localIdentity, writer, emit } = setup();
    localIdentity.start();

    // When
    emit({ kind: "signed-in", userId: "user-1", summary: null });

    // Then
    expect(writer.write).toHaveBeenCalledExactlyOnceWith("user-1");
  });

  it("signed-outで消す", () => {
    // Given
    const { localIdentity, writer, emit } = setup();
    localIdentity.start();

    // When
    emit({ kind: "signed-out" });

    // Then
    expect(writer.write).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("概要つきのサインインでは、利用者の識別情報を書いた後に概要を書く", () => {
    // Given
    const { localIdentity, writer, summaries, emit } = setup();
    localIdentity.start();

    // When
    emit({ kind: "signed-in", userId: "user-1", summary: linked });

    // Then
    expect(writer.write).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(summaries.write).toHaveBeenCalledExactlyOnceWith(linked);
    expect(writer.write.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(summaries.write).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("概要を読めない通知では、前の記録を書き換えず、消さず、利用者の識別情報は記録する", () => {
    // Given
    const { localIdentity, writer, summaries, emit } = setup();
    localIdentity.start();
    emit({ kind: "signed-in", userId: "user-1", summary: linked });

    // When
    emit({ kind: "signed-in", userId: "user-1", summary: null });

    // Then
    expect(writer.write).toHaveBeenCalledTimes(2);
    expect(summaries.write).toHaveBeenCalledExactlyOnceWith(linked);
    expect(summaries.clear).not.toHaveBeenCalled();
  });

  it("signed-outでは、概要の記録も消す", () => {
    // Given
    const { localIdentity, summaries, emit } = setup();
    localIdentity.start();

    // When
    emit({ kind: "signed-out" });

    // Then
    expect(summaries.clear).toHaveBeenCalledOnce();
    expect(summaries.write).not.toHaveBeenCalled();
  });

  it("始めた回数だけ購読し、返す関数で購読を解除する", () => {
    // Given
    const { localIdentity, events, unsubscribe } = setup();

    // When
    const stop = localIdentity.start();
    stop();

    // Then
    expect(events.subscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("解除した後の出来事では、記録も消去もしない", () => {
    // Given
    const { localIdentity, writer, emit } = setup();
    const stop = localIdentity.start();
    stop();

    // When
    emit({ kind: "signed-in", userId: "user-1", summary: null });
    emit({ kind: "signed-out" });

    // Then
    expect(writer.write).not.toHaveBeenCalled();
  });
});
