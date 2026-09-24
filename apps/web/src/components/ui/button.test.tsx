import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  describe("表示", () => {
    it("子要素をボタンとして表示する", () => {
      // Given
      const label = "Click me";

      // When
      render(<Button>{label}</Button>);

      // Then
      expect(screen.getByRole("button", { name: label })).toHaveAttribute(
        "data-slot",
        "button",
      );
    });

    describe("variant・size", () => {
      it("未指定の場合、defaultのクラスを付与する", () => {
        // Given
        const label = "Click me";

        // When
        render(<Button>{label}</Button>);

        // Then
        const button = screen.getByRole("button", { name: label });
        expect(button).toHaveClass("bg-primary", "h-8");
      });

      it("指定した場合、指定したvariant・sizeのクラスを付与する", () => {
        // Given
        const label = "Click me";

        // When
        render(
          <Button variant="destructive" size="icon-sm">
            {label}
          </Button>,
        );

        // Then
        const button = screen.getByRole("button", { name: label });
        expect(button).toHaveClass("bg-destructive/10", "size-7");
        expect(button).not.toHaveClass("bg-primary", "h-8");
      });
    });

    describe("className", () => {
      it("指定したクラスを付与する", () => {
        // Given
        const className = "custom-class";

        // When
        render(<Button className={className}>Click me</Button>);

        // Then
        expect(screen.getByRole("button", { name: "Click me" })).toHaveClass(
          "custom-class",
        );
      });
    });

    describe("disabled", () => {
      it("指定した場合、ボタンを無効にする", () => {
        // Given
        const label = "Click me";

        // When
        render(<Button disabled>{label}</Button>);

        // Then
        expect(screen.getByRole("button", { name: label })).toBeDisabled();
      });
    });
  });

  describe("クリック", () => {
    it("onClickを呼び出す", async () => {
      // Given
      const handleClick = vi.fn();
      const user = userEvent.setup();
      render(<Button onClick={handleClick}>Click me</Button>);

      // When
      await user.click(screen.getByRole("button", { name: "Click me" }));

      // Then
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });
});
