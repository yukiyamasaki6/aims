import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import RoundsPage from "./page";

// ホームの取得と表示は別のテストで確かめるため、ホームの部品は目印だけを描画するスタブにする。
vi.mock("@/features/rounds/ui/rounds-home", () => ({
  RoundsHome: () => <div data-testid="rounds-home" />,
}));

describe("RoundsPage", () => {
  it("取得を伴わず、見出しなしでホームの部品だけを描画する", () => {
    // Given
    // When
    render(<RoundsPage />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getByTestId("rounds-home")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
