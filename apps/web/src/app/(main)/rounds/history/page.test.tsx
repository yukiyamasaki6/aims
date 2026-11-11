import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import RoundsHistoryPage from "./page";

// 履歴の取得と表示は別のテストで確かめるため、履歴の部品は目印だけを描画するスタブにする。
vi.mock("@/features/rounds/ui/rounds-history", () => ({
  RoundsHistory: () => <div data-testid="rounds-history" />,
}));

describe("RoundsHistoryPage", () => {
  it("見出しなしで履歴の部品だけを描画する", () => {
    // Given
    // When
    render(<RoundsHistoryPage />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getByTestId("rounds-history")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
