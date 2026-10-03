import { describe, expect, it } from "vitest";
import { FRAME_ENTRIES, frameUrlFor } from "./sw-frames";

describe("sw-frames", () => {
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
      const url = frameUrlFor(pathname);

      // Then
      expect(url).toBe(expected);
    });

    it.each([
      "/",
      "/signin",
      "/offline",
      "/rounds/",
      "/rounds/abc/x",
      "/rounds/new/x",
      "/roundsx",
      "/__shell/rounds",
    ])("%sは枠がない", (pathname) => {
      // Given
      // When
      const url = frameUrlFor(pathname);

      // Then
      expect(url).toBeNull();
    });

    it("newは任意IDの枠にならない", () => {
      // Given
      // When
      const url = frameUrlFor("/rounds/new");

      // Then
      expect(url).not.toBe("/__shell/rounds/_");
    });
  });

  describe("FRAME_ENTRIES", () => {
    it("枠の3画面すべてのURLを、プリキャッシュ対象として持つ", () => {
      // Given
      // When
      const urls = FRAME_ENTRIES.map(({ url }) => url);

      // Then
      expect(urls).toEqual([
        "/__shell/rounds",
        "/__shell/rounds/new",
        "/__shell/rounds/_",
      ]);
    });

    it("frameUrlForが返す枠のURLは、すべてプリキャッシュ対象に含まれる", () => {
      // Given
      const urls = FRAME_ENTRIES.map(({ url }) => url);

      // When
      const frames = ["/rounds", "/rounds/new", "/rounds/x"].map(frameUrlFor);

      // Then
      for (const frame of frames) expect(urls).toContain(frame);
    });
  });
});
