import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeIntersectionObserver } from "./intersection-observer-test-helpers";

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("installFakeIntersectionObserver", () => {
  it("交差を起こすと、生きている観測の全てに交差を通知する", () => {
    // Given
    const fake = installFakeIntersectionObserver();
    const first = vi.fn();
    const second = vi.fn();
    new IntersectionObserver(first).observe(document.createElement("div"));
    new IntersectionObserver(second).observe(document.createElement("div"));

    // When
    fake.intersect();

    // Then
    expect(first).toHaveBeenCalledWith([{ isIntersecting: true }]);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("切り離した観測には通知せず、生きている観測の一覧からも外す", () => {
    // Given
    const fake = installFakeIntersectionObserver();
    const callback = vi.fn();
    const observer = new IntersectionObserver(callback);
    observer.observe(document.createElement("div"));

    // When
    observer.disconnect();
    fake.intersect();

    // Then
    expect(callback).not.toHaveBeenCalled();
    expect(fake.observers()).toEqual([]);
  });

  it("交差している状態にすると、以降に作った観測は観測を始めた時点で通知する", () => {
    // Given
    const fake = installFakeIntersectionObserver();
    fake.setNear(true);
    const callback = vi.fn();

    // When
    new IntersectionObserver(callback).observe(document.createElement("div"));

    // Then
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("観測の設定と対象を記録する", () => {
    // Given
    const fake = installFakeIntersectionObserver();
    const root = document.createElement("div");
    const target = document.createElement("div");

    // When
    new IntersectionObserver(vi.fn(), { root }).observe(target);

    // Then
    const [record] = fake.observers();
    expect(record?.init?.root).toBe(root);
    expect([...(record?.targets ?? [])]).toEqual([target]);
  });
});
