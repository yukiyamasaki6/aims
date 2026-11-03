import { describe, expect, it, vi } from "vitest";
import { createRouterPageNavigation } from "./router-page-navigation";

describe("createRouterPageNavigation", () => {
  it("goは、遷移の部品のpushをその経路で呼ぶ", () => {
    // Given
    const push = vi.fn();
    const pageNavigation = createRouterPageNavigation({
      push,
      replace: vi.fn(),
    });

    // When
    pageNavigation.go("/rounds/abc");

    // Then
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/rounds/abc");
  });

  it("pushが投げた例外は、変換されずにそのままgoから出る", () => {
    // Given
    const failure = new Error("rejected path");
    const pageNavigation = createRouterPageNavigation({
      push: () => {
        throw failure;
      },
      replace: vi.fn(),
    });

    // When
    let thrown: unknown;
    try {
      pageNavigation.go("/rounds/abc");
    } catch (error) {
      thrown = error;
    }

    // Then
    expect(thrown).toBe(failure);
  });

  it("replaceは、遷移の部品のreplaceをその経路で呼ぶ。pushは呼ばない", () => {
    // Given
    const push = vi.fn();
    const replace = vi.fn();
    const pageNavigation = createRouterPageNavigation({ push, replace });

    // When
    pageNavigation.replace("/rounds");

    // Then
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/rounds");
    expect(push).not.toHaveBeenCalled();
  });

  it("replaceが投げた例外は、変換されずにそのままreplaceから出る", () => {
    // Given
    const failure = new Error("rejected path");
    const pageNavigation = createRouterPageNavigation({
      push: vi.fn(),
      replace: () => {
        throw failure;
      },
    });

    // When
    let thrown: unknown;
    try {
      pageNavigation.replace("/rounds");
    } catch (error) {
      thrown = error;
    }

    // Then
    expect(thrown).toBe(failure);
  });
});
