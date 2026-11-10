import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { KeypadPanel } from "./keypad-panel";

describe("KeypadPanel", () => {
  it("shows children and the close button while open", () => {
    // Given

    // When
    render(
      <KeypadPanel open onNodeChange={vi.fn()} onClose={vi.fn()}>
        score buttons
      </KeypadPanel>,
      { wrapper: IntlTestProvider },
    );

    // Then
    expect(screen.getByText("score buttons")).toBeInTheDocument();
    expect(screen.getByTestId("keypad-panel-close")).toBeInTheDocument();
    expect(screen.getByTestId("keypad-panel")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
  });

  it("marks the panel aria-hidden while closed", () => {
    // Given

    // When
    render(
      <KeypadPanel open={false} onNodeChange={vi.fn()} onClose={vi.fn()}>
        score buttons
      </KeypadPanel>,
      { wrapper: IntlTestProvider },
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
      <KeypadPanel open onNodeChange={vi.fn()} onClose={onClose}>
        score buttons
      </KeypadPanel>,
      { wrapper: IntlTestProvider },
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
      <KeypadPanel open onNodeChange={vi.fn()} onClose={vi.fn()}>
        score buttons
      </KeypadPanel>,
      { wrapper: IntlTestProvider },
    );

    // Then
    // 唯一のボタンは閉じるボタン自身であり、レフトパネルのような
    // 全画面を覆う灰色オーバーレイ用のボタンは存在しない。
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
