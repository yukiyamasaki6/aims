import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RoundsPage from "./page";

// 一覧の取得と表示は別のテストで確かめるため、クライアントコンポーネントは目印だけを描画するスタブにする。
vi.mock("./rounds-list-client", () => ({
  RoundsListClient: () => <div data-testid="rounds-list-client" />,
}));

describe("RoundsPage", () => {
  it("取得を伴わず、見出しと一覧のクライアントコンポーネントだけを描画する", () => {
    // Given
    // When
    render(<RoundsPage />);

    // Then
    expect(
      screen.getByRole("heading", { name: "ラウンド一覧" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rounds-list-client")).toBeInTheDocument();
  });
});
