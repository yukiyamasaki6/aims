import { describe, expect, it } from "vitest";
import { isShellUrl } from "./offline-routes";

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
});
