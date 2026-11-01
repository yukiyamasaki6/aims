import { describe, expect, it, vi } from "vitest";
import { createRouterNavigation } from "./router-navigation";

describe("createRouterNavigation", () => {
  it("goは、遷移の部品のpushをその経路で呼ぶ", () => {
    // Given
    const push = vi.fn();
    const navigation = createRouterNavigation({ push, replace: vi.fn() });

    // When
    navigation.go("/rounds/abc");

    // Then
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/rounds/abc");
  });

  it("pushが投げた例外は、変換されずにそのままgoから出る", () => {
    // Given
    const failure = new Error("rejected path");
    const navigation = createRouterNavigation({
      push: () => {
        throw failure;
      },
      replace: vi.fn(),
    });

    // When
    let thrown: unknown;
    try {
      navigation.go("/rounds/abc");
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
    const navigation = createRouterNavigation({ push, replace });

    // When
    navigation.replace("/rounds");

    // Then
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/rounds");
    expect(push).not.toHaveBeenCalled();
  });

  it("replaceが投げた例外は、変換されずにそのままreplaceから出る", () => {
    // Given
    const failure = new Error("rejected path");
    const navigation = createRouterNavigation({
      push: vi.fn(),
      replace: () => {
        throw failure;
      },
    });

    // When
    let thrown: unknown;
    try {
      navigation.replace("/rounds");
    } catch (error) {
      thrown = error;
    }

    // Then
    expect(thrown).toBe(failure);
  });
});
