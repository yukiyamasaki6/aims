import { describe, expect, it, vi } from "vitest";
import { createFakeConnectivity } from "./fake-connectivity-test-helpers";

describe("createFakeConnectivity", () => {
  it("可否を替えて購読者へ知らせ、解除した購読者には知らせない", () => {
    // Given
    const connectivity = createFakeConnectivity();
    const online = vi.fn();
    const offline = vi.fn();
    connectivity.onOnline(online);
    connectivity.onOffline(offline)();

    // When
    connectivity.goOffline();
    const afterOffline = connectivity.isOffline();
    connectivity.goOnline();

    // Then
    expect(afterOffline).toBe(true);
    expect(connectivity.isOffline()).toBe(false);
    expect(online).toHaveBeenCalledTimes(1);
    expect(offline).not.toHaveBeenCalled();
    expect(connectivity.subscribers()).toEqual({ online: 1, offline: 0 });
  });

  it("最初の可否を指定できる", () => {
    // Given
    // When
    const connectivity = createFakeConnectivity(true);

    // Then
    expect(connectivity.isOffline()).toBe(true);
  });
});
