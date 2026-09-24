import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { PasswordInput } from "./password-input";

// Button（button.test.tsxで検証済み）とInput（input.test.tsxで検証済み）は、このテストを削除してもテスト対象以外のカバレッジに影響しないように、別モジュールとの境界としてモックする。
// Buttonはvariant・sizeを除いた属性をbuttonへ、Inputは全ての属性をinputへそのまま渡すスタブで模す。
vi.mock("@/components/ui/button", () => ({
  Button: function ButtonStub({
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<"button"> & { variant?: string; size?: string }) {
    return <button {...props} />;
  },
}));

vi.mock("@/components/ui/input", () => ({
  Input: function InputStub(props: React.ComponentProps<"input">) {
    return <input {...props} />;
  },
}));

// cn（utils.test.tsで検証済み）は、渡されたクラスを空白区切りで連結するスタブで模す。
vi.mock("@/lib/utils", () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(" "),
}));

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
