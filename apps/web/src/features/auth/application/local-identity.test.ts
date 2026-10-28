import { describe, expect, it, vi } from "vitest";
import type { AuthChange } from "../domain/auth-change";
import { createLocalIdentity } from "./local-identity";

function setup() {
  const listeners: Array<(event: AuthChange) => void> = [];
  const unsubscribe = vi.fn();
  const writer = { write: vi.fn() };
  const events = {
    subscribe: vi.fn((listener: (event: AuthChange) => void) => {
      listeners.push(listener);
      // 解除すると、実際にこのリスナーへ以降の出来事が届かなくなる。
      return () => {
        unsubscribe();
        listeners.splice(listeners.indexOf(listener), 1);
      };
    }),
  };
  const localIdentity = createLocalIdentity({ changes: events, writer });
  return {
    localIdentity,
    writer,
    events,
    unsubscribe,
    emit(event: AuthChange) {
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
    emit({ kind: "signed-in", userId: "user-1" });

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

  it("記録も消去もしない変化では、書かない", () => {
    // Given
    const { localIdentity, writer, emit } = setup();
    localIdentity.start();

    // When
    emit({ kind: "other" });
    emit({ kind: "initial", userId: null });

    // Then
    expect(writer.write).not.toHaveBeenCalled();
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
    emit({ kind: "signed-in", userId: "user-1" });
    emit({ kind: "signed-out" });

    // Then
    expect(writer.write).not.toHaveBeenCalled();
  });
});
