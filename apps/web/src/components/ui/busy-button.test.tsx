import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BusyButton } from "./busy-button";

function spinnerOf(container: HTMLElement) {
  return container.querySelector("svg.animate-spin");
}

describe("BusyButton", () => {
  it("処理中でなければ、押せる表示で、スピナーを出さない", () => {
    // Given

    // When
    const { container } = render(<BusyButton busy={false}>保存</BusyButton>);

    // Then
    const button = screen.getByRole("button", { name: "保存" });
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(button).not.toHaveClass("pointer-events-none");
    expect(spinnerOf(container)).toBeNull();
  });

  it("処理中は、aria-disabledを真にして押せない表示にし、スピナーを出す", () => {
    // Given

    // When
    const { container } = render(<BusyButton busy>保存</BusyButton>);

    // Then
    const button = screen.getByRole("button", { name: "保存" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveClass("pointer-events-none", "opacity-50");
    expect(spinnerOf(container)).not.toBeNull();
  });

  it("処理中でも、spinnerを偽にすればスピナーを出さない", () => {
    // Given

    // When
    const { container } = render(
      <BusyButton busy spinner={false}>
        保存
      </BusyButton>,
    );

    // Then
    expect(screen.getByRole("button")).toHaveAttribute("aria-disabled", "true");
    expect(spinnerOf(container)).toBeNull();
  });

  it("処理中でなくても、spinnerを真にすればスピナーを出す", () => {
    // Given

    // When
    const { container } = render(
      <BusyButton busy={false} spinner>
        保存
      </BusyButton>,
    );

    // Then
    expect(spinnerOf(container)).not.toBeNull();
  });

  it("渡したclassNameとボタンの属性を引き継ぐ", () => {
    // Given

    // When
    render(
      <BusyButton busy={false} className="extra" data-testid="b">
        保存
      </BusyButton>,
    );

    // Then
    expect(screen.getByTestId("b")).toHaveClass("extra");
  });
});
