import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { useOptionLabels } from "./use-option-labels";

const roundsText = translatorFor("rounds");

describe("useOptionLabels", () => {
  it("種別と弓種の値を、表示名にする", () => {
    // Given
    const { result } = renderHook(() => useOptionLabels(), {
      wrapper: IntlTestProvider,
    });

    // When
    const { formatLabel, bowTypeLabel } = result.current;

    // Then
    expect(formatLabel("outdoor")).toBe(roundsText("formatOption.outdoor"));
    expect(bowTypeLabel("barebow")).toBe(roundsText("bowTypeOption.barebow"));
  });

  it("選択肢を、値と表示名の組で、並びのとおり返す", () => {
    // Given
    const { result } = renderHook(() => useOptionLabels(), {
      wrapper: IntlTestProvider,
    });

    // When
    const { formatOptions, bowTypeOptions } = result.current;

    // Then
    expect(formatOptions).toEqual([
      { value: "outdoor", label: "アウトドア" },
      { value: "indoor", label: "インドア" },
      { value: "field", label: "フィールド" },
    ]);
    expect(bowTypeOptions.map((o) => o.label)).toEqual([
      roundsText("bowTypeOption.recurve"),
      roundsText("bowTypeOption.compound"),
      roundsText("bowTypeOption.barebow"),
    ]);
  });
});
