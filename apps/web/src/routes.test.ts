import { describe, expect, it } from "vitest";
import {
  CHANGE_EMAIL_HASH,
  CHANGE_PASSWORD_HASH,
  DELETE_ACCOUNT_HASH,
  FRAME_PATHS,
  frameHtmlOf,
  roundPath,
  SETTINGS_ACCOUNT_HASH,
  SETTINGS_HASH,
  shellUrlOf,
} from "./routes";

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

  describe("FRAME_PATHS", () => {
    it("ラウンドの4画面だけを、重複なく含む", () => {
      // Given
      // When
      const paths = FRAME_PATHS;

      // Then
      expect(paths).toHaveLength(4);
      expect(new Set(paths).size).toBe(4);
      expect(paths).toEqual(
        expect.arrayContaining([
          "/rounds",
          "/rounds/history",
          "/rounds/new",
          "/rounds/_",
        ]),
      );
    });
  });

  describe("設定パネルのハッシュ", () => {
    it("設定全体と、分類「アカウント」とその項目のハッシュの値を持つ", () => {
      // Given
      // When
      const hashes = [
        SETTINGS_HASH,
        SETTINGS_ACCOUNT_HASH,
        CHANGE_EMAIL_HASH,
        CHANGE_PASSWORD_HASH,
        DELETE_ACCOUNT_HASH,
      ];

      // Then
      expect(hashes).toEqual([
        "#settings",
        "#settings/account",
        "#settings/account/email",
        "#settings/account/password",
        "#settings/account/delete-account",
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
