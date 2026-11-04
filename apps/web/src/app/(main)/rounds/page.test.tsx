import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import RoundsPage from "./page";

// 一覧の取得と表示は別のテストで確かめるため、一覧の部品は目印だけを描画するスタブにする。
vi.mock("@/features/rounds/ui/rounds-list", () => ({
  RoundsList: () => <div data-testid="rounds-list" />,
}));

describe("RoundsPage", () => {
  it("取得を伴わず、見出しと一覧の部品だけを描画する", () => {
    // Given
    // When
    render(<RoundsPage />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("heading", { name: "ラウンド一覧" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rounds-list")).toBeInTheDocument();
  });
});
