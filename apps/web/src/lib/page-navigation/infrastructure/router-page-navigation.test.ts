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
});
