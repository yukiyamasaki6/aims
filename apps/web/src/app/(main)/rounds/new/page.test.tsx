import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import NewRoundPage from "./page";

// 取得と表示は別のテストで確かめるため、クライアントコンポーネントは目印だけを描画するスタブにする。
const received = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));
vi.mock("@/features/rounds/ui/round-preset-select", () => ({
  RoundPresetSelect: (props: Record<string, unknown>) => {
    received.props = props;
    return <div data-testid="round-preset-select" />;
  },
}));

describe("NewRoundPage", () => {
  it("取得を伴わず、プリセット選択のクライアントコンポーネントだけを描画する", () => {
    // Given
    // When
    render(<NewRoundPage />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getByTestId("round-preset-select")).toBeInTheDocument();
  });

  it("入口は何も生成せず、子に何も渡さない", () => {
    // Given
    // When
    render(<NewRoundPage />, { wrapper: IntlTestProvider });

    // Then
    expect(received.props).toEqual({});
  });
});
