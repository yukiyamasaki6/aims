import { describe, expect, it, vi } from "vitest";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { whenOnline } from "./when-online";

function setup(offline: boolean) {
  return { connectivity: createFakeConnectivity(offline) };
}

describe("whenOnline", () => {
  it("今オンラインなら、直ちに1回呼び、購読を張らない", () => {
    // Given
    const tab = setup(false);
    const listener = vi.fn();

    // When
    whenOnline(tab.connectivity, listener);
    tab.connectivity.goOffline();
    tab.connectivity.goOnline();

    // Then
    expect(listener).toHaveBeenCalledOnce();
    expect(tab.connectivity.subscribers().online).toBe(0);
  });

  it("オフラインなら呼ばずに待ち、次に通信が戻ったときに1回だけ呼ぶ", () => {
    // Given
    const tab = setup(true);
    const listener = vi.fn();
    whenOnline(tab.connectivity, listener);
    const calledBeforeReturn = listener.mock.calls.length;

    // When
    tab.connectivity.goOnline();
    tab.connectivity.goOffline();
    tab.connectivity.goOnline();

    // Then
    expect(calledBeforeReturn).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
    expect(tab.connectivity.subscribers().online).toBe(0);
  });

  it("返す関数で取り消すと、通信が戻っても呼ばない", () => {
    // Given
    const tab = setup(true);
    const listener = vi.fn();
    const cancel = whenOnline(tab.connectivity, listener);

    // When
    cancel();
    tab.connectivity.goOnline();

    // Then
    expect(listener).not.toHaveBeenCalled();
    expect(tab.connectivity.subscribers().online).toBe(0);
  });

  it("オンラインで直ちに呼んだ後に、返す関数を呼んでも何も起きない", () => {
    // Given
    const tab = setup(false);
    const listener = vi.fn();
    const cancel = whenOnline(tab.connectivity, listener);

    // When
    const act = () => cancel();

    // Then
    expect(act).not.toThrow();
    expect(listener).toHaveBeenCalledOnce();
  });
});
