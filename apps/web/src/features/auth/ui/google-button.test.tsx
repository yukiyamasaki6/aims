import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GoogleButton } from "./google-button";

describe("GoogleButton", () => {
  it("渡された文言を名前に持ち、押すと呼ばれる", async () => {
    // Given
    const onClick = vi.fn();
    render(
      <GoogleButton busy={false} onClick={onClick}>
        渡した文言
      </GoogleButton>,
    );
    const user = userEvent.setup();

    // When
    await user.click(screen.getByRole("button", { name: "渡した文言" }));

    // Then
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("処理中は、押せない状態とスピナーを示し、押しても呼ばれない", async () => {
    // Given
    const onClick = vi.fn();
    render(
      <GoogleButton busy onClick={onClick}>
        渡した文言
      </GoogleButton>,
    );
    const button = screen.getByRole("button", { name: "渡した文言" });
    const user = userEvent.setup();

    // When
    await user.click(button);

    // Then
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });

  it("処理中でなければ、押せる状態でスピナーを示さない", () => {
    // Given
    // When
    render(
      <GoogleButton busy={false} onClick={vi.fn()}>
        渡した文言
      </GoogleButton>,
    );

    // Then
    const button = screen.getByRole("button", { name: "渡した文言" });
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(button.querySelector(".animate-spin")).toBeNull();
  });
});
