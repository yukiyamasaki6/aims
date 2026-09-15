import { describe, expect, it } from "vitest";
import { comparePositionKey } from "./position-key";

describe("comparePositionKey", () => {
  it("position_keyの辞書順で並べる", () => {
    expect(comparePositionKey("a", "z", "b", "a")).toBeLessThan(0);
  });

  it("position_keyが同じ場合はIDで順序を確定する", () => {
    expect(comparePositionKey("a", "1", "a", "2")).toBeLessThan(0);
  });
});
