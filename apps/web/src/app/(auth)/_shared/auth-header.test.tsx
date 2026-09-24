import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthHeader } from "./auth-header";

describe("AuthHeader", () => {
  describe("表示", () => {
    describe("title", () => {
      it("指定した値を見出しとして表示する", () => {
        // Given
        const title = "サインイン";

        // When
        render(<AuthHeader title={title} />);

        // Then
        expect(
          screen.getByRole("heading", { level: 1, name: title }),
        ).toBeInTheDocument();
      });
    });

    describe("description", () => {
      it("指定した場合、説明文を表示する", () => {
        // Given
        const description = "説明文";

        // When
        render(<AuthHeader title="サインイン" description={description} />);

        // Then
        expect(screen.getByText(description)).toBeInTheDocument();
      });

      it("指定しない場合、説明文を表示しない", () => {
        // Given
        const title = "サインイン";

        // When
        const { container } = render(<AuthHeader title={title} />);

        // Then
        expect(container.querySelector("p")).toBeNull();
      });
    });

    describe("onBack", () => {
      it("指定した場合、戻るボタンを表示する", () => {
        // Given
        const handleBack = vi.fn();

        // When
        render(<AuthHeader title="サインイン" onBack={handleBack} />);

        // Then
        expect(
          screen.getByRole("button", { name: /戻る/ }),
        ).toBeInTheDocument();
      });

      it("指定しない場合、戻るボタンを表示しない", () => {
        // Given
        const title = "サインイン";

        // When
        render(<AuthHeader title={title} />);

        // Then
        expect(
          screen.queryByRole("button", { name: /戻る/ }),
        ).not.toBeInTheDocument();
      });
    });

    describe("backDisabled", () => {
      it("trueの場合、戻るボタンをaria-disabledにする", () => {
        // Given
        const handleBack = vi.fn();

        // When
        render(
          <AuthHeader title="サインイン" onBack={handleBack} backDisabled />,
        );

        // Then
        expect(screen.getByRole("button", { name: /戻る/ })).toHaveAttribute(
          "aria-disabled",
          "true",
        );
      });

      it.each([
        { label: "false", backDisabled: false },
        { label: "未指定", backDisabled: undefined },
      ])(
        "$labelの場合、戻るボタンをaria-disabledにしない",
        ({ backDisabled }) => {
          // Given
          const handleBack = vi.fn();

          // When
          render(
            <AuthHeader
              title="サインイン"
              onBack={handleBack}
              backDisabled={backDisabled}
            />,
          );

          // Then
          expect(
            screen.getByRole("button", { name: /戻る/ }),
          ).not.toHaveAttribute("aria-disabled", "true");
        },
      );
    });
  });

  describe("戻るボタンのクリック", () => {
    it("onBackを呼び出す", async () => {
      // Given
      const handleBack = vi.fn();
      const user = userEvent.setup();
      render(<AuthHeader title="サインイン" onBack={handleBack} />);

      // When
      await user.click(screen.getByRole("button", { name: /戻る/ }));

      // Then
      expect(handleBack).toHaveBeenCalledTimes(1);
    });

    // 操作の抑止は呼び出し側の責務とし、AuthHeaderはaria-disabledの付与のみを行う。
    it("backDisabledがtrueの場合も、onBackを呼び出す", async () => {
      // Given
      const handleBack = vi.fn();
      const user = userEvent.setup();
      render(
        <AuthHeader title="サインイン" onBack={handleBack} backDisabled />,
      );

      // When
      await user.click(screen.getByRole("button", { name: /戻る/ }));

      // Then
      expect(handleBack).toHaveBeenCalledTimes(1);
    });
  });
});
