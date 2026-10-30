import { describe, expect, it, vi } from "vitest";
import { createRouterNavigation } from "./router-navigation";

describe("createRouterNavigation", () => {
  it("goは、遷移の部品のpushをその経路で呼ぶ", () => {
    // Given
    const push = vi.fn();
    const navigation = createRouterNavigation({ push });

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
});
