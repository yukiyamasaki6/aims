import { describe, expect, it } from "vitest";
import { frameHtmlOf, roundPath, shellUrlOf } from "./routes";

describe("routes", () => {
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

  describe("roundPath", () => {
    it("ラウンドのIDから、詳細の経路を作る", () => {
      // Given
      // When
      const path = roundPath("abc");

      // Then
      expect(path).toBe("/rounds/abc");
    });
  });
});
