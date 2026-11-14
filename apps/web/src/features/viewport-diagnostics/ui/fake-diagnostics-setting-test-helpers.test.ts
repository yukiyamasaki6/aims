import { describe, expect, it, vi } from "vitest";
import { createFakeDiagnosticsSetting } from "./fake-diagnostics-setting-test-helpers";

describe("createFakeDiagnosticsSetting", () => {
  it("初期値を読め、書くと購読者へ知らせて読める値が変わる", () => {
    // Given
    const setting = createFakeDiagnosticsSetting(false);
    const listener = vi.fn();
    setting.subscribe(listener);

    // When
    setting.write(true);

    // Then
    expect(setting.read()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("解除した購読者へは知らせない", () => {
    // Given
    const setting = createFakeDiagnosticsSetting();
    const listener = vi.fn();
    const unsubscribe = setting.subscribe(listener);
    unsubscribe();

    // When
    setting.write(true);

    // Then
    expect(listener).not.toHaveBeenCalled();
  });
});
