import { expect, it } from "vitest";
import { labelOf } from "./option-label";
import { FORMAT_OPTIONS } from "./round-constants";

it("該当するvalueのlabelを返す", () => {
  // Given
  const value = "indoor";

  // When
  const result = labelOf(FORMAT_OPTIONS, value);

  // Then
  expect(result).toBe("インドア");
});

it("該当するvalueがなければvalueをそのまま返す", () => {
  // Given
  const value = "unknown";

  // When
  const result = labelOf(FORMAT_OPTIONS, value);

  // Then
  expect(result).toBe("unknown");
});
