import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  describe("表示", () => {
    it("data-slotを付与した入力欄を表示する", () => {
      // Given
      const placeholder = "入力";

      // When
      render(<Input placeholder={placeholder} />);

      // Then
      expect(screen.getByPlaceholderText("入力")).toHaveAttribute(
        "data-slot",
        "input",
      );
    });

    describe("type", () => {
      it("指定した値を入力欄へ渡す", () => {
        // Given
        const type = "email";

        // When
        render(<Input placeholder="入力" type={type} />);

        // Then
        expect(screen.getByPlaceholderText("入力")).toHaveAttribute(
          "type",
          "email",
        );
      });
    });

    describe("className", () => {
      it("既定のクラスに加えて、指定したクラスを付与する", () => {
        // Given
        const className = "custom-class";

        // When
        render(<Input placeholder="入力" className={className} />);

        // Then
        expect(screen.getByPlaceholderText("入力")).toHaveClass(
          "h-8",
          "custom-class",
        );
      });
    });
  });

  describe("入力", () => {
    it("value・onChangeを入力欄へ渡す", async () => {
      // Given
      const handleChange = vi.fn();
      const user = userEvent.setup();
      render(<Input placeholder="入力" value="" onChange={handleChange} />);

      // When
      await user.type(screen.getByPlaceholderText("入力"), "a");

      // Then
      expect(screen.getByPlaceholderText("入力")).toHaveValue("");
      expect(handleChange).toHaveBeenCalledTimes(1);
    });
  });
});
