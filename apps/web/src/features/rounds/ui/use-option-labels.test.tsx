import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { useOptionLabels } from "./use-option-labels";

describe("useOptionLabels", () => {
  it("種別と弓種の値を、表示名にする", () => {
    // Given
    const { result } = renderHook(() => useOptionLabels(), {
      wrapper: IntlTestProvider,
    });

    // When
    const { formatLabel, bowTypeLabel } = result.current;

    // Then
    expect(formatLabel("outdoor")).toBe("アウトドア");
    expect(bowTypeLabel("barebow")).toBe("ベアボウ");
  });

  it("選択肢に無い値は、値のまま返す", () => {
    // Given
    const { result } = renderHook(() => useOptionLabels(), {
      wrapper: IntlTestProvider,
    });

    // When
    const { formatLabel, bowTypeLabel } = result.current;

    // Then
    expect(formatLabel("unknown")).toBe("unknown");
    expect(bowTypeLabel("unknown")).toBe("unknown");
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
      "リカーブ",
      "コンパウンド",
      "ベアボウ",
    ]);
  });
});
