import { describe, expect, it } from "vitest";
import {
  ROUND_FRAME_PATHS,
  roundFramePathOf,
} from "@/features/rounds/domain/round-routes";
import {
  frameHtmlOf,
  frameUrlFor,
  isShellUrl,
  OFFLINE_PATH,
  SHELL_PREFIX,
  shellUrlOf,
} from "./offline-routes";

describe("offline-routes", () => {
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
      // When
      const entries = ROUND_FRAME_PATHS.map((path) => ({
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

  describe("isShellUrl", () => {
    it.each([
      ["/__shell/rounds", true],
      ["/__shell/rounds/_", true],
      ["/__shell", false],
      ["/__shellx/rounds", false],
      ["/rounds", false],
    ])("%sは%sである", (pathname, expected) => {
      // Given
      // When
      const shell = isShellUrl(pathname);

      // Then
      expect(shell).toBe(expected);
    });
  });

  describe("frameUrlFor", () => {
    it.each([
      ["/rounds", "/__shell/rounds"],
      ["/rounds/new", "/__shell/rounds/new"],
      ["/rounds/6f1c2f3e-0000-4000-8000-000000000000", "/__shell/rounds/_"],
      ["/rounds/abc", "/__shell/rounds/_"],
      ["/rounds/_", "/__shell/rounds/_"],
    ])("%sは%sに対応する", (pathname, expected) => {
      // Given
      // When
      const url = frameUrlFor(pathname, roundFramePathOf);

      // Then
      expect(url).toBe(expected);
    });

    it.each(["/", "/signin", "/offline", "/rounds/", "/rounds/abc/x"])(
      "%sは枠がない",
      (pathname) => {
        // Given
        // When
        const url = frameUrlFor(pathname, roundFramePathOf);

        // Then
        expect(url).toBeNull();
      },
    );

    it("frameUrlForが返す枠のURLは、すべてプリキャッシュ対象に含まれる", () => {
      // Given
      const urls = ROUND_FRAME_PATHS.map(shellUrlOf);

      // When
      const frames = ["/rounds", "/rounds/new", "/rounds/x"].map((pathname) =>
        frameUrlFor(pathname, roundFramePathOf),
      );

      // Then
      for (const frame of frames) expect(urls).toContain(frame);
    });
  });
});
