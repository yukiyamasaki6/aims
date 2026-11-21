import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { CHANGE_EMAIL_HASH, DELETE_ACCOUNT_HASH } from "@/routes";
import { SettingsAccount } from "./settings-account";

const settingsText = translatorFor("settings");
const authText = translatorFor("auth");

const googleRowText = "google-row-content";

function renderAccount(
  overrides: {
    email?: string;
    onMove?: () => void;
    onBusyChange?: (busy: boolean) => void;
    renderGoogle?: (controls: {
      onBusyChange: (busy: boolean) => void;
    }) => ReactNode;
    signOut?: ReactNode;
  } = {},
) {
  return render(
    <SettingsAccount
      email={overrides.email ?? "user@example.com"}
      renderGoogle={
        overrides.renderGoogle ?? (() => <span>{googleRowText}</span>)
      }
      onBusyChange={overrides.onBusyChange ?? vi.fn()}
      onMove={overrides.onMove ?? vi.fn()}
      signOut={
        overrides.signOut === undefined ? (
          <button type="button">{authText("signOut")}</button>
        ) : (
          overrides.signOut
        )
      }
    />,
    { wrapper: IntlTestProvider },
  );
}

describe("SettingsAccount", () => {
  it("メールアドレス、Google認証、アカウント削除、サインアウトの順に4行を並べる", () => {
    // Given
    // When
    const { container } = renderAccount();

    // Then
    const text = container.textContent ?? "";
    const positions = [
      settingsText("emailRow"),
      "user@example.com",
      settingsText("emailChange"),
      settingsText("googleRow"),
      googleRowText,
      settingsText("deleteAccountRow"),
      settingsText("deleteAccountAction"),
      authText("signOut"),
    ].map((part) => text.indexOf(part));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("メールアドレスが読めないときは、値を空にする", () => {
    // Given
    // When
    renderAccount({ email: "" });

    // Then
    const link = screen.getByRole("link", {
      name: settingsText("emailChange"),
    });
    expect(link.previousElementSibling?.textContent).toBe("");
  });

  it("本文に分類の見出しを表示しない", () => {
    // Given
    // When
    renderAccount();

    // Then
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText(settingsText("accountTitle"))).toBeNull();
  });

  it("Google認証の行の描画へ、処理中を知らせる操作を渡す", async () => {
    // Given
    const user = userEvent.setup();
    const onBusyChange = vi.fn();

    // When
    renderAccount({
      onBusyChange,
      renderGoogle: (controls) => (
        <button type="button" onClick={() => controls.onBusyChange(true)}>
          google-busy
        </button>
      ),
    });
    await user.click(screen.getByRole("button", { name: "google-busy" }));

    // Then
    expect(onBusyChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("サインアウトの行を渡さなければ、その行を表示しない", () => {
    // Given
    // When
    renderAccount({ signOut: null });

    // Then
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["emailChange", "email", CHANGE_EMAIL_HASH],
    ["deleteAccountAction", "delete-account", DELETE_ACCOUNT_HASH],
  ] as const)(
    "%sのリンクは経路表のハッシュを持ち、押すと既定の動作を止めて%sで移る操作を呼ぶ",
    async (textKey, view, hash) => {
      // Given
      const user = userEvent.setup();
      const onMove = vi.fn();
      const defaultPrevented = vi.fn((event: Event) => event.defaultPrevented);
      renderAccount({ onMove });
      // イベントが伝わりきった後の既定の動作の停止を、ドキュメントで受けて確かめる。
      document.addEventListener("click", defaultPrevented);
      const link = screen.getByRole("link", { name: settingsText(textKey) });

      // When
      await user.click(link);

      // Then
      document.removeEventListener("click", defaultPrevented);
      expect(link).toHaveAttribute("href", hash);
      expect(onMove).toHaveBeenCalledExactlyOnceWith(view);
      expect(defaultPrevented).toHaveReturnedWith(true);
    },
  );

  it("変更のリンクへTabで到達してEnterを押すと、移る操作を通知する", async () => {
    // Given
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderAccount({ onMove });

    // When
    await user.tab();
    await user.keyboard("{Enter}");

    // Then
    expect(
      screen.getByRole("link", { name: settingsText("emailChange") }),
    ).toHaveFocus();
    expect(onMove).toHaveBeenCalledWith("email");
  });
});
