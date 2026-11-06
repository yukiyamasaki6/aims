import { describe, expect, it } from "vitest";
import {
  frameHtmlOf,
  NEW_ROUND_PATH,
  OFFLINE_PATH,
  ROUND_FRAME_ID,
  ROUND_FRAME_PATH,
  ROUND_FRAME_PATHS,
  ROUNDS_PATH,
  roundPath,
  SHELL_PREFIX,
  shellUrlOf,
} from "./routes";

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

  it("ラウンドの一覧と作成の経路を持つ", () => {
    // Given
    // When
    const paths = [ROUNDS_PATH, NEW_ROUND_PATH];

    // Then
    expect(paths).toEqual(["/rounds", "/rounds/new"]);
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

  it("詳細の枠のプレースホルダーのIDと経路を持つ", () => {
    // Given
    // When
    const frame = [ROUND_FRAME_ID, ROUND_FRAME_PATH];

    // Then
    expect(frame).toEqual(["_", "/rounds/_"]);
  });

  describe("ROUND_FRAME_PATHS", () => {
    it("枠の3画面(一覧、作成、詳細)の経路を持つ", () => {
      // Given
      // When
      const paths = ROUND_FRAME_PATHS;

      // Then
      expect(paths).toEqual(["/rounds", "/rounds/new", "/rounds/_"]);
    });
  });
});
