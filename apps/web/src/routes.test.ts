import { describe, expect, it } from "vitest";
import {
  CHANGE_PASSWORD_PATH,
  FRAME_PATHS,
  frameHtmlOf,
  roundPath,
  SETTINGS_PATH,
  shellUrlOf,
} from "./routes";

describe("routes", () => {
  describe("shellUrlOf、frameHtmlOf", () => {
    it("枠の経路から、配布用のURLとビルド成果物のHTMLの名前を導く", () => {
      // Given
      const framePaths = [
        "/rounds",
        "/rounds/new",
        "/rounds/_",
        "/settings",
        "/settings/password",
      ];

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
        { url: "/__shell/settings", html: "settings.html" },
        {
          url: "/__shell/settings/password",
          html: "settings/password.html",
        },
      ]);
    });
  });

  describe("FRAME_PATHS", () => {
    it("ラウンドの4画面と設定の2画面を、重複なく含む", () => {
      // Given
      // When
      const paths = FRAME_PATHS;

      // Then
      expect(SETTINGS_PATH).toBe("/settings");
      expect(CHANGE_PASSWORD_PATH).toBe("/settings/password");
      expect(paths).toHaveLength(6);
      expect(new Set(paths).size).toBe(6);
      expect(paths).toEqual(
        expect.arrayContaining([
          "/rounds",
          "/rounds/history",
          "/rounds/new",
          "/rounds/_",
          "/settings",
          "/settings/password",
        ]),
      );
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
