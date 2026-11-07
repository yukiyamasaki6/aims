import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import NewRoundPage from "./page";

// 取得と表示は別のテストで確かめるため、クライアントコンポーネントは目印だけを描画するスタブにする。
vi.mock("@/features/rounds/ui/round-preset-select", () => ({
  RoundPresetSelect: () => <div data-testid="round-preset-select" />,
}));

describe("NewRoundPage", () => {
  it("取得を伴わず、プリセット選択のクライアントコンポーネントだけを描画する", () => {
    // Given
    // When
    render(<NewRoundPage />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getByTestId("round-preset-select")).toBeInTheDocument();
  });
});
