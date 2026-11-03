import { describe, expect, it } from "vitest";
import { createFakePageNavigation } from "./fake-page-navigation-test-helpers";

describe("createFakePageNavigation", () => {
  it("goとreplaceの呼び出しを観測でき、logへ順に追記する", () => {
    // Given
    const log: string[] = ["append:done"];
    const { pageNavigation, go, replace } = createFakePageNavigation({ log });

    // When
    pageNavigation.go("/a");
    pageNavigation.replace("/b");

    // Then
    expect(go).toHaveBeenCalledWith("/a");
    expect(replace).toHaveBeenCalledWith("/b");
    expect(log).toEqual(["append:done", "go:/a", "replace:/b"]);
  });

  it("logを渡さなくても、呼び出しを観測できる", () => {
    // Given
    const { pageNavigation, go } = createFakePageNavigation();

    // When
    pageNavigation.go("/a");

    // Then
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("failureを渡すと、goとreplaceのどちらも投げる(呼び出しは記録する)", () => {
    // Given
    const failure = new Error("failed");
    const log: string[] = [];
    const { pageNavigation } = createFakePageNavigation({ log, failure });

    // When
    const go = () => pageNavigation.go("/a");
    const replace = () => pageNavigation.replace("/b");

    // Then
    expect(go).toThrow(failure);
    expect(replace).toThrow(failure);
    expect(log).toEqual(["go:/a", "replace:/b"]);
  });

  it("onGoは、goのときだけ呼ばれる", () => {
    // Given
    const gone: string[] = [];
    const { pageNavigation } = createFakePageNavigation({
      onGo: (path) => gone.push(path),
    });

    // When
    pageNavigation.go("/a");
    pageNavigation.replace("/b");

    // Then
    expect(gone).toEqual(["/a"]);
  });
});
