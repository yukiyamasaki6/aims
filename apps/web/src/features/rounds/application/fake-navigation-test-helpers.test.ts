import { describe, expect, it } from "vitest";
import { createFakeNavigation } from "./fake-navigation-test-helpers";

describe("createFakeNavigation", () => {
  it("goとreplaceの呼び出しを観測でき、logへ順に追記する", () => {
    // Given
    const log: string[] = ["append:done"];
    const { navigation, go, replace } = createFakeNavigation({ log });

    // When
    navigation.go("/a");
    navigation.replace("/b");

    // Then
    expect(go).toHaveBeenCalledWith("/a");
    expect(replace).toHaveBeenCalledWith("/b");
    expect(log).toEqual(["append:done", "go:/a", "replace:/b"]);
  });

  it("logを渡さなくても、呼び出しを観測できる", () => {
    // Given
    const { navigation, go } = createFakeNavigation();

    // When
    navigation.go("/a");

    // Then
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("failureを渡すと、goとreplaceのどちらも投げる(呼び出しは記録する)", () => {
    // Given
    const failure = new Error("failed");
    const log: string[] = [];
    const { navigation } = createFakeNavigation({ log, failure });

    // When
    const go = () => navigation.go("/a");
    const replace = () => navigation.replace("/b");

    // Then
    expect(go).toThrow(failure);
    expect(replace).toThrow(failure);
    expect(log).toEqual(["go:/a", "replace:/b"]);
  });

  it("onGoは、goのときだけ呼ばれる", () => {
    // Given
    const gone: string[] = [];
    const { navigation } = createFakeNavigation({
      onGo: (path) => gone.push(path),
    });

    // When
    navigation.go("/a");
    navigation.replace("/b");

    // Then
    expect(gone).toEqual(["/a"]);
  });
});
