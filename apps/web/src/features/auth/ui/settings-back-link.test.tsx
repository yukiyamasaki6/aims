import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { SETTINGS_PATH } from "@/routes";
import { SettingsBackLink } from "./settings-back-link";

const authText = translatorFor("auth");

describe("SettingsBackLink", () => {
  it("通常は、名前「戻る」のリンクで、設定画面へ向かう", () => {
    // Given
    // When
    render(<SettingsBackLink disabled={false} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    expect(
      screen.getByRole("link", { name: authText("back") }),
    ).toHaveAttribute("href", SETTINGS_PATH);
  });

  describe("disabled", () => {
    it("リンクではなく、aria-disabledの表示になる", () => {
      // Given
      // When
      render(<SettingsBackLink disabled />, { wrapper: IntlTestProvider });

      // Then
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText(authText("back"))).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    it("押しても遷移先を持たず、Tabでフォーカスが入らない", async () => {
      // Given
      const user = userEvent.setup();
      render(<SettingsBackLink disabled />, { wrapper: IntlTestProvider });

      // When
      await user.click(screen.getByText(authText("back")));
      await user.tab();

      // Then
      expect(screen.getByText(authText("back")).closest("a")).toBeNull();
      expect(screen.getByText(authText("back"))).not.toHaveFocus();
      expect(document.body).toHaveFocus();
    });
  });
});
