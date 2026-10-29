import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "./page";

// 子の部品は別のテストで確かめるため、受け取ったpropsを記録する代役に差し替える。
const received = vi.hoisted(() => ({
  props: undefined as { sessionReader?: { readSession?: unknown } } | undefined,
}));
vi.mock("./start-button", () => ({
  StartButton: (props: NonNullable<typeof received.props>) => {
    received.props = props;
    return <a href="/signup">開始</a>;
  },
}));

describe("Home", () => {
  it("アプリ名と説明文、開始ボタン、AIMSロゴを表示する", () => {
    // Given
    // When
    render(<Home />);

    // Then
    expect(screen.getByRole("heading", { name: "AIMS" })).toBeInTheDocument();
    expect(
      screen.getByText("アーチェリーのスコア記録・分析・共有アプリ"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開始" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AIMS" })).toBeInTheDocument();
  });

  it("サインインの状態の読み手を、開始ボタンへ渡す", () => {
    // Given
    // When
    render(<Home />);

    // Then
    expect(received.props?.sessionReader?.readSession).toBeTypeOf("function");
  });
});
