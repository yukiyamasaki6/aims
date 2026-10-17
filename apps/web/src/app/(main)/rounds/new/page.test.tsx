import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NewRoundPage from "./page";

// 取得と表示は別のテストで確かめるため、クライアントコンポーネントは目印だけを描画するスタブにする。
vi.mock("./round-preset-select-client", () => ({
  RoundPresetSelect: () => <div data-testid="round-preset-select" />,
}));

describe("NewRoundPage", () => {
  it("取得を伴わず、プリセット選択のクライアントコンポーネントだけを描画する", () => {
    // Given
    // When
    render(<NewRoundPage />);

    // Then
    expect(screen.getByTestId("round-preset-select")).toBeInTheDocument();
  });
});
