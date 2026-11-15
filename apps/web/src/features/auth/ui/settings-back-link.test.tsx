import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { SettingsBackLink } from "./settings-back-link";

const authText = translatorFor("auth");

describe("SettingsBackLink", () => {
  it("通常は、名前「戻る」のリンクで、押すと既定の動作を止めてonBackを呼ぶ", async () => {
    // Given
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onNavigate = vi.fn((event: Event) => event.defaultPrevented);
    render(<SettingsBackLink disabled={false} onBack={onBack} />, {
      wrapper: IntlTestProvider,
    });
    const link = screen.getByRole("link", { name: authText("back") });
    // イベントが伝わりきった後の既定の動作の停止を、ドキュメントで受けて確かめる。
    document.addEventListener("click", onNavigate);

    // When
    await user.click(link);

    // Then
    document.removeEventListener("click", onNavigate);
    expect(onBack).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveReturnedWith(true);
  });

  describe("disabled", () => {
    it("リンクではなく、aria-disabledの表示になる", () => {
      // Given
      // When
      render(<SettingsBackLink disabled onBack={vi.fn()} />, {
        wrapper: IntlTestProvider,
      });

      // Then
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText(authText("back"))).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    it("押しても、onBackを呼ばない", async () => {
      // Given
      const user = userEvent.setup();
      const onBack = vi.fn();
      render(<SettingsBackLink disabled onBack={onBack} />, {
        wrapper: IntlTestProvider,
      });

      // When
      await user.click(screen.getByText(authText("back")));

      // Then
      expect(onBack).not.toHaveBeenCalled();
      expect(screen.getByText(authText("back")).closest("a")).toBeNull();
    });

    it("Tabでフォーカスが入らない", async () => {
      // Given
      const user = userEvent.setup();
      render(<SettingsBackLink disabled onBack={vi.fn()} />, {
        wrapper: IntlTestProvider,
      });

      // When
      await user.tab();

      // Then
      expect(screen.getByText(authText("back"))).not.toHaveFocus();
      expect(document.body).toHaveFocus();
    });
  });
});
