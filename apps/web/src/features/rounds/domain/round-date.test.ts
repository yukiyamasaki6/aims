import { describe, expect, it } from "vitest";
import { formatCardDate } from "./round-date";

describe("formatCardDate", () => {
  it("ISO形式の日付を、ゼロ埋めのままスラッシュ区切りにする", () => {
    // Given
    const date = "2026-05-01";

    // When
    const formatted = formatCardDate(date);

    // Then
    expect(formatted).toBe("2026/05/01");
  });

  it.each(["", "2026-5-1", "2026/05/01"])(
    "形式に合わない値(%j)はそのまま返す",
    (value) => {
      // Given
      const input = value;

      // When
      const formatted = formatCardDate(input);

      // Then
      expect(formatted).toBe(input);
    },
  );
});
