import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
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
      it("指定したクラスを付与する", () => {
        // Given
        const className = "custom-class";

        // When
        render(<Input placeholder="入力" className={className} />);

        // Then
        expect(screen.getByPlaceholderText("入力")).toHaveClass("custom-class");
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

  describe("Enterキー", () => {
    describe("formに属さない場合", () => {
      it("変換中でないEnterでフォーカスを外し、入力値は保持する", async () => {
        // Given
        const user = userEvent.setup();
        render(<Input placeholder="入力" />);
        const input = screen.getByPlaceholderText("入力");
        await user.type(input, "abc");

        // When
        await user.keyboard("{Enter}");

        // Then
        expect(input).not.toHaveFocus();
        expect(input).toHaveValue("abc");
      });

      it("IME変換中のEnterではフォーカスを外さない", () => {
        // Given
        render(<Input placeholder="入力" />);
        const input = screen.getByPlaceholderText("入力");
        input.focus();

        // When
        fireEvent.keyDown(input, { key: "Enter", isComposing: true });

        // Then
        expect(input).toHaveFocus();
      });

      it("Enter以外のキーではフォーカスを外さない", async () => {
        // Given
        const user = userEvent.setup();
        render(<Input placeholder="入力" />);
        const input = screen.getByPlaceholderText("入力");
        await user.click(input);

        // When
        await user.keyboard("a");

        // Then
        expect(input).toHaveFocus();
      });

      it("呼び出し側のonKeyDownを呼び、そこでpreventDefaultするとフォーカスを外さない", () => {
        // Given
        const handleKeyDown = vi.fn((e: React.KeyboardEvent) =>
          e.preventDefault(),
        );
        render(<Input placeholder="入力" onKeyDown={handleKeyDown} />);
        const input = screen.getByPlaceholderText("入力");
        input.focus();

        // When
        fireEvent.keyDown(input, { key: "Enter" });

        // Then
        expect(handleKeyDown).toHaveBeenCalled();
        expect(input).toHaveFocus();
      });
    });

    describe("form内の場合", () => {
      it("フォーカスを外さず、Enterで送信される", async () => {
        // Given
        const user = userEvent.setup();
        const handleSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
        render(
          <form onSubmit={handleSubmit}>
            <Input placeholder="入力" />
          </form>,
        );
        const input = screen.getByPlaceholderText("入力");
        await user.click(input);

        // When
        await user.keyboard("{Enter}");

        // Then
        expect(input).toHaveFocus();
        expect(handleSubmit).toHaveBeenCalledTimes(1);
      });
    });
  });
});
