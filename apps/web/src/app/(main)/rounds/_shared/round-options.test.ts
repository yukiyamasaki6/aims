import { expect, it } from "vitest";
import { FORMAT_OPTIONS, labelOf } from "./round-options";

it("該当するvalueのlabelを返す", () => {
  expect(labelOf(FORMAT_OPTIONS, "indoor")).toBe("インドア");
});

it("該当するvalueがなければvalueをそのまま返す", () => {
  expect(labelOf(FORMAT_OPTIONS, "unknown")).toBe("unknown");
});
