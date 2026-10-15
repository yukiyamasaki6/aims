import { describe, expect, it } from "vitest";
import { comparePositionKey } from "./position-key";

describe("comparePositionKey", () => {
  it("position_keyの辞書順で並べる", () => {
    expect(comparePositionKey("a", "z", "b", "a")).toBeLessThan(0);
  });

  it("position_keyの辞書順が逆の場合も正しく並べる", () => {
    expect(comparePositionKey("b", "a", "a", "z")).toBeGreaterThan(0);
  });

  it("position_keyが同じ場合はIDで順序を確定する", () => {
    expect(comparePositionKey("a", "1", "a", "2")).toBeLessThan(0);
  });

  it("position_keyが同じでIDの順序が逆の場合も正しく並べる", () => {
    expect(comparePositionKey("a", "2", "a", "1")).toBeGreaterThan(0);
  });

  it("position_key・ID共に同じ場合は0を返す", () => {
    expect(comparePositionKey("a", "1", "a", "1")).toBe(0);
  });
});
