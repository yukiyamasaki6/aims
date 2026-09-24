import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PasswordInput } from "./password-input";

function toggleButton() {
  return screen.getByRole("button", { name: /パスワードを(表示|非表示)/ });
}

describe("PasswordInput", () => {
  describe("表示", () => {
    it("初期状態では値を伏せ、表示ボタンを表示する", () => {
      // Given
      const placeholder = "パスワード";

      // When
      render(<PasswordInput placeholder={placeholder} />);

      // Then
      expect(screen.getByPlaceholderText("パスワード")).toHaveAttribute(
        "type",
        "password",
      );
      expect(toggleButton()).toHaveAccessibleName("パスワードを表示");
    });

    describe("className", () => {
      it("入力欄に指定したクラスを付与する", () => {
        // Given
        const className = "custom-class";

        // When
        render(
          <PasswordInput placeholder="パスワード" className={className} />,
        );

        // Then
        expect(screen.getByPlaceholderText("パスワード")).toHaveClass(
          "pr-8",
          "custom-class",
        );
      });
    });
  });

  describe("表示切替ボタンのクリック", () => {
    it("1回押すと値を平文で表示し、非表示ボタンに切り替える", async () => {
      // Given
      const user = userEvent.setup();
      render(<PasswordInput placeholder="パスワード" />);

      // When
      await user.click(toggleButton());

      // Then
      expect(screen.getByPlaceholderText("パスワード")).toHaveAttribute(
        "type",
        "text",
      );
      expect(toggleButton()).toHaveAccessibleName("パスワードを非表示");
    });

    it("2回押すと値を再び伏せ、表示ボタンに戻す", async () => {
      // Given
      const user = userEvent.setup();
      render(<PasswordInput placeholder="パスワード" />);

      // When
      await user.click(toggleButton());
      await user.click(toggleButton());

      // Then
      expect(screen.getByPlaceholderText("パスワード")).toHaveAttribute(
        "type",
        "password",
      );
      expect(toggleButton()).toHaveAccessibleName("パスワードを表示");
    });
  });

  describe("入力", () => {
    it("value・onChangeを入力欄へ渡す", async () => {
      // Given
      const handleChange = vi.fn();
      const user = userEvent.setup();
      render(
        <PasswordInput
          placeholder="パスワード"
          value=""
          onChange={handleChange}
        />,
      );

      // When
      await user.type(screen.getByPlaceholderText("パスワード"), "a");

      // Then
      expect(handleChange).toHaveBeenCalledTimes(1);
    });
  });
});
