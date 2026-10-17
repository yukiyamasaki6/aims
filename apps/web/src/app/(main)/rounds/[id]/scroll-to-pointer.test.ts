import { describe, expect, it } from "vitest";
import { revealDelta } from "./scroll-to-pointer";

describe("revealDelta", () => {
  const visible = { visibleTop: 100, visibleBottom: 500 };

  it("行が見える範囲に収まる場合は0を返す", () => {
    // Given
    // When
    const delta = revealDelta({ cellTop: 200, cellBottom: 240, ...visible });

    // Then
    expect(delta).toBe(0);
  });

  it("行が見える範囲の端にちょうど接する場合は0を返す", () => {
    // Given
    // When
    const delta = revealDelta({ cellTop: 100, cellBottom: 500, ...visible });

    // Then
    expect(delta).toBe(0);
  });

  it("行が下に1はみ出す場合は、許容の範囲として動かさない", () => {
    // Given
    // When
    const delta = revealDelta({ cellTop: 461, cellBottom: 501, ...visible });

    // Then
    expect(delta).toBe(0);
  });

  it("行が下に2はみ出す場合は、はみ出した分だけ正の値を返す", () => {
    // Given
    // When
    const delta = revealDelta({ cellTop: 462, cellBottom: 502, ...visible });

    // Then
    expect(delta).toBe(2);
  });

  it("行が上に1はみ出す場合は、許容の範囲として動かさない", () => {
    // Given
    // When
    const delta = revealDelta({ cellTop: 99, cellBottom: 139, ...visible });

    // Then
    expect(delta).toBe(0);
  });

  it("行が上に2はみ出す場合は、はみ出した分だけ負の値を返す", () => {
    // Given
    // When
    const delta = revealDelta({ cellTop: 98, cellBottom: 138, ...visible });

    // Then
    expect(delta).toBe(-2);
  });

  it("行が上下の両方にはみ出す場合は、下に隠れる分を優先する", () => {
    // Given
    // When
    const delta = revealDelta({ cellTop: 50, cellBottom: 550, ...visible });

    // Then
    expect(delta).toBe(50);
  });
});
