import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { PasswordInput } from "./password-input";

const authText = translatorFor("auth");

function toggleButton() {
  return screen.getByRole("button", {
    name: new RegExp(`${authText("passwordShow")}|${authText("passwordHide")}`),
  });
}

describe("PasswordInput", () => {
  describe("表示", () => {
    it("初期状態では値を伏せ、表示ボタンを表示する", () => {
      // Given
      const placeholder = authText("passwordPlaceholder");

      // When
      render(<PasswordInput placeholder={placeholder} />, {
        wrapper: IntlTestProvider,
      });

      // Then
      expect(
        screen.getByPlaceholderText(authText("passwordPlaceholder")),
      ).toHaveAttribute("type", "password");
      expect(toggleButton()).toHaveAccessibleName(authText("passwordShow"));
    });

    describe("className", () => {
      it("入力欄に指定したクラスを付与する", () => {
        // Given
        const className = "custom-class";

        // When
        render(
          <PasswordInput placeholder="パスワード" className={className} />,
          { wrapper: IntlTestProvider },
        );

        // Then
        expect(
          screen.getByPlaceholderText(authText("passwordPlaceholder")),
        ).toHaveClass("custom-class");
      });
    });
  });

  describe("表示切替ボタンのクリック", () => {
    it("1回押すと値を平文で表示し、非表示ボタンに切り替える", async () => {
      // Given
      const user = userEvent.setup();
      render(<PasswordInput placeholder="パスワード" />, {
        wrapper: IntlTestProvider,
      });

      // When
      await user.click(toggleButton());

      // Then
      expect(
        screen.getByPlaceholderText(authText("passwordPlaceholder")),
      ).toHaveAttribute("type", "text");
      expect(toggleButton()).toHaveAccessibleName(authText("passwordHide"));
    });

    it("2回押すと値を再び伏せ、表示ボタンに戻す", async () => {
      // Given
      const user = userEvent.setup();
      render(<PasswordInput placeholder="パスワード" />, {
        wrapper: IntlTestProvider,
      });

      // When
      await user.click(toggleButton());
      await user.click(toggleButton());

      // Then
      expect(
        screen.getByPlaceholderText(authText("passwordPlaceholder")),
      ).toHaveAttribute("type", "password");
      expect(toggleButton()).toHaveAccessibleName(authText("passwordShow"));
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
        { wrapper: IntlTestProvider },
      );

      // When
      await user.type(
        screen.getByPlaceholderText(authText("passwordPlaceholder")),
        "a",
      );

      // Then
      expect(handleChange).toHaveBeenCalledTimes(1);
    });
  });
});
