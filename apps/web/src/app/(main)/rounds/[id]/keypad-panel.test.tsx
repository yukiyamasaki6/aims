import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KeypadPanel } from "./keypad-panel";

describe("KeypadPanel", () => {
  it("renders nothing when not mounted", () => {
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

    expect(container).toBeEmptyDOMElement();
  });

  it("shows children and the close button while mounted and visible", () => {
    render(
      <KeypadPanel mounted visible onNodeChange={vi.fn()} onClose={vi.fn()}>
        score buttons
      </KeypadPanel>,
    );

    expect(screen.getByText("score buttons")).toBeInTheDocument();
    expect(screen.getByTestId("keypad-panel-close")).toBeInTheDocument();
    expect(screen.getByTestId("keypad-panel")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
  });

  it("marks the panel aria-hidden while mounted but not visible", () => {
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

    expect(screen.getByTestId("keypad-panel")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <KeypadPanel mounted visible onNodeChange={vi.fn()} onClose={onClose}>
        score buttons
      </KeypadPanel>,
    );

    await user.click(screen.getByTestId("keypad-panel-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never renders a backdrop overlay, unlike the left panel's mobile menu", () => {
    render(
      <KeypadPanel mounted visible onNodeChange={vi.fn()} onClose={vi.fn()}>
        score buttons
      </KeypadPanel>,
    );

    // 唯一のボタンは閉じるボタン自身であり、レフトパネルのような
    // 全画面を覆う灰色オーバーレイ用のボタンは存在しない。
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
