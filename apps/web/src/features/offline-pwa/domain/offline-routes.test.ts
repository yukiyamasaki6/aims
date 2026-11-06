import { describe, expect, it } from "vitest";
import {
  ROUND_FRAME_PATHS,
  roundFramePathOf,
} from "@/features/rounds/domain/round-routes";
import { shellUrlOf } from "@/routes";
import { frameUrlFor, isShellUrl } from "./offline-routes";

describe("offline-routes", () => {
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
