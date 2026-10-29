import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NewRoundPage from "./page";

// 取得と表示は別のテストで確かめるため、クライアントコンポーネントは目印だけを描画するスタブにする。
const received = vi.hoisted(() => ({
  props: undefined as
    | {
        sessionReader?: { readSession?: unknown };
        identityReader?: { read?: unknown };
      }
    | undefined,
}));
vi.mock("./round-preset-select-client", () => ({
  RoundPresetSelect: (props: NonNullable<typeof received.props>) => {
    received.props = props;
    return <div data-testid="round-preset-select" />;
  },
}));

describe("NewRoundPage", () => {
  it("取得を伴わず、プリセット選択のクライアントコンポーネントだけを描画する", () => {
    // Given
    // When
    render(<NewRoundPage />);

    // Then
    expect(screen.getByTestId("round-preset-select")).toBeInTheDocument();
  });

  it("サインインの状態と端末の識別情報の読み手を、子へ渡す", () => {
    // Given
    // When
    render(<NewRoundPage />);

    // Then
    expect(received.props?.sessionReader?.readSession).toBeTypeOf("function");
    expect(received.props?.identityReader?.read).toBeTypeOf("function");
  });
});
