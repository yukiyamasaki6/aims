import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KeypadPanel } from "./keypad-panel";

describe("KeypadPanel", () => {
  it("renders nothing when not mounted", () => {
    // Given

    // When
    const { container } = render(
      <KeypadPanel
        mounted={false}
        visible={false}
        onNodeChange={vi.fn()}
        onClose={vi.fn()}
      >
        score buttons
      </KeypadPanel>,
    );

    // Then
    expect(container).toBeEmptyDOMElement();
  });

  it("shows children and the close button while mounted and visible", () => {
    // Given

    // When
    render(
      <KeypadPanel mounted visible onNodeChange={vi.fn()} onClose={vi.fn()}>
        score buttons
      </KeypadPanel>,
    );

    // Then
    expect(screen.getByText("score buttons")).toBeInTheDocument();
    expect(screen.getByTestId("keypad-panel-close")).toBeInTheDocument();
    expect(screen.getByTestId("keypad-panel")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
  });

  it("marks the panel aria-hidden while mounted but not visible", () => {
    // Given

    // When
    render(
      <KeypadPanel
        mounted
        visible={false}
        onNodeChange={vi.fn()}
        onClose={vi.fn()}
      >
        score buttons
      </KeypadPanel>,
    );

    // Then
    expect(screen.getByTestId("keypad-panel")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("calls onClose when the close button is clicked", async () => {
    // Given
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <KeypadPanel mounted visible onNodeChange={vi.fn()} onClose={onClose}>
        score buttons
      </KeypadPanel>,
    );

    // When
    await user.click(screen.getByTestId("keypad-panel-close"));

    // Then
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never renders a backdrop overlay, unlike the left panel's mobile menu", () => {
    // Given

    // When
    render(
      <KeypadPanel mounted visible onNodeChange={vi.fn()} onClose={vi.fn()}>
        score buttons
      </KeypadPanel>,
    );

    // Then
    // 唯一のボタンは閉じるボタン自身であり、レフトパネルのような
    // 全画面を覆う灰色オーバーレイ用のボタンは存在しない。
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
