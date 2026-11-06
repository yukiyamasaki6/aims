import { describe, expect, it } from "vitest";
import { frameHtmlOf, OFFLINE_PATH, SHELL_PREFIX, shellUrlOf } from "./routes";

describe("routes", () => {
  it("オフラインの経路と枠の配布の接頭辞を持つ", () => {
    // Given
    // When
    const paths = [OFFLINE_PATH, SHELL_PREFIX];

    // Then
    expect(paths).toEqual(["/offline", "/__shell"]);
  });

  describe("shellUrlOf、frameHtmlOf", () => {
    it("枠の経路から、配布用のURLとビルド成果物のHTMLの名前を導く", () => {
      // Given
      const framePaths = ["/rounds", "/rounds/new", "/rounds/_"];

      // When
      const entries = framePaths.map((path) => ({
        url: shellUrlOf(path),
        html: frameHtmlOf(path),
      }));

      // Then
      expect(entries).toEqual([
        { url: "/__shell/rounds", html: "rounds.html" },
        { url: "/__shell/rounds/new", html: "rounds/new.html" },
        { url: "/__shell/rounds/_", html: "rounds/_.html" },
      ]);
    });
  });
});
