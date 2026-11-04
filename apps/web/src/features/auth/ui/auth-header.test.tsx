import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { AuthHeader } from "./auth-header";

const authText = translatorFor("auth");

describe("AuthHeader", () => {
  describe("表示", () => {
    describe("title", () => {
      it("指定した値を見出しとして表示する", () => {
        // Given

        // When
        const title = authText("signInTitle");
        render(<AuthHeader title={title} />, { wrapper: IntlTestProvider });

        // Then
        expect(
          screen.getByRole("heading", { level: 1, name: title }),
        ).toBeInTheDocument();
      });
    });

    describe("description", () => {
      it("指定した場合、説明文を表示する", () => {
        // Given

        // When
        const description = "説明文";
        render(<AuthHeader title="サインイン" description={description} />, {
          wrapper: IntlTestProvider,
        });

        // Then
        expect(screen.getByText(description)).toBeInTheDocument();
      });

      it("指定しない場合、説明文を表示しない", () => {
        // Given

        // When
        const title = authText("signInTitle");
        const { container } = render(<AuthHeader title={title} />, {
          wrapper: IntlTestProvider,
        });

        // Then
        expect(container.querySelector("p")).toBeNull();
      });
    });

    describe("onBack", () => {
      it("指定した場合、戻るボタンを表示する", () => {
        // Given

        // When
        const handleBack = vi.fn();
        render(<AuthHeader title="サインイン" onBack={handleBack} />, {
          wrapper: IntlTestProvider,
        });

        // Then
        expect(
          screen.getByRole("button", { name: authText("back") }),
        ).toBeInTheDocument();
      });

      it("指定しない場合、戻るボタンを表示しない", () => {
        // Given

        // When
        const title = authText("signInTitle");
        render(<AuthHeader title={title} />, { wrapper: IntlTestProvider });

        // Then
        expect(
          screen.queryByRole("button", { name: authText("back") }),
        ).not.toBeInTheDocument();
      });
    });

    describe("backDisabled", () => {
      it("trueの場合、戻るボタンをaria-disabledにする", () => {
        // Given

        // When
        const handleBack = vi.fn();
        render(
          <AuthHeader title="サインイン" onBack={handleBack} backDisabled />,
          { wrapper: IntlTestProvider },
        );

        // Then
        expect(
          screen.getByRole("button", { name: authText("back") }),
        ).toHaveAttribute("aria-disabled", "true");
      });

      it.each([
        { label: "false", backDisabled: false },
        { label: "未指定", backDisabled: undefined },
      ])(
        "$labelの場合、戻るボタンをaria-disabledにしない",
        ({ backDisabled }) => {
          // Given

          // When
          const handleBack = vi.fn();
          render(
            <AuthHeader
              title="サインイン"
              onBack={handleBack}
              backDisabled={backDisabled}
            />,
            { wrapper: IntlTestProvider },
          );

          // Then
          expect(
            screen.getByRole("button", { name: authText("back") }),
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
      render(<AuthHeader title="サインイン" onBack={handleBack} />, {
        wrapper: IntlTestProvider,
      });

      // When
      await user.click(screen.getByRole("button", { name: authText("back") }));

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
        { wrapper: IntlTestProvider },
      );

      // When
      await user.click(screen.getByRole("button", { name: authText("back") }));

      // Then
      expect(handleBack).toHaveBeenCalledTimes(1);
    });
  });
});
