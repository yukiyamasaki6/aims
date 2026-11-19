import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { SettingsAccount } from "./settings-account";

const settingsText = translatorFor("settings");
const authText = translatorFor("auth");

function itemLink(name: string) {
  return screen.getByRole("link", { name });
}

describe("SettingsAccount", () => {
  it("メールアドレス変更、パスワード変更、アカウント削除、サインアウトの順に行を並べる", () => {
    // Given
    // When
    const { container } = render(
      <SettingsAccount
        onMove={vi.fn()}
        signOut={<button type="button">{authText("signOut")}</button>}
      />,
      { wrapper: IntlTestProvider },
    );

    // Then
    const rows = Array.from(
      container.querySelectorAll("a, button"),
      (row) => row.textContent,
    );
    expect(rows).toEqual([
      settingsText("changeEmailItem"),
      settingsText("deleteAccountItem"),
      authText("signOut"),
    ]);
  });

  it("本文に分類の見出しを表示しない", () => {
    // Given
    // When
    render(<SettingsAccount onMove={vi.fn()} signOut={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText(settingsText("accountTitle"))).toBeNull();
  });

  it("サインアウトの行を渡さなければ、3行だけを表示する", () => {
    // Given
    // When
    render(<SettingsAccount onMove={vi.fn()} signOut={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      settingsText("changeEmailItem"),
      settingsText("deleteAccountItem"),
    ]);
    expect(links[0].parentElement?.children).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["changeEmailItem", "email"],
    ["deleteAccountItem", "delete-account"],
  ] as const)(
    "%sの行を押すと、既定の動作(ページの移動)を止めて、%sの表示で移る操作を呼ぶ",
    async (textKey, view) => {
      // Given
      const user = userEvent.setup();
      const onMove = vi.fn();
      const defaultPrevented = vi.fn((event: Event) => event.defaultPrevented);
      render(<SettingsAccount onMove={onMove} signOut={null} />, {
        wrapper: IntlTestProvider,
      });
      // イベントが伝わりきった後の既定の動作の停止を、ドキュメントで受けて確かめる。
      document.addEventListener("click", defaultPrevented);

      // When
      await user.click(itemLink(settingsText(textKey)));

      // Then
      document.removeEventListener("click", defaultPrevented);
      expect(onMove).toHaveBeenCalledExactlyOnceWith(view);
      expect(defaultPrevented).toHaveReturnedWith(true);
    },
  );

  it.each([
    ["changeEmailItem", "email", 1],
    ["deleteAccountItem", "delete-account", 2],
  ] as const)(
    "%sの行へTabで到達してEnterを押すと、%sへ移る操作を通知する",
    async (textKey, view, tabCount) => {
      // Given
      const user = userEvent.setup();
      const onMove = vi.fn();
      render(<SettingsAccount onMove={onMove} signOut={null} />, {
        wrapper: IntlTestProvider,
      });

      // When
      for (let index = 0; index < tabCount; index++) await user.tab();
      await user.keyboard("{Enter}");

      // Then
      expect(itemLink(settingsText(textKey))).toHaveFocus();
      expect(onMove).toHaveBeenCalledWith(view);
    },
  );
});
