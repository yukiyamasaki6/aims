import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { CHANGE_EMAIL_PATH } from "@/routes";
import { SettingsScreen } from "./settings-screen";

const settingsText = translatorFor("settings");

function accountSection() {
  return screen.getByRole("region", { name: settingsText("accountTitle") });
}

describe("SettingsScreen", () => {
  it("見出し「設定」と、分類「アカウント」の見出しを表示する", () => {
    // Given
    // When
    render(<SettingsScreen account={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    expect(
      screen.getByRole("heading", { level: 1, name: settingsText("title") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: settingsText("accountTitle"),
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(2);
  });

  it("分類「アカウント」の区画の中に、「メールアドレス変更」と「パスワード変更」の項目を表示する", () => {
    // Given
    // When
    render(<SettingsScreen account={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    expect(
      within(accountSection()).getByRole("link", {
        name: settingsText("changeEmailItem"),
      }),
    ).toBeVisible();
    expect(
      within(accountSection()).getByRole("link", {
        name: settingsText("changePasswordItem"),
      }),
    ).toBeVisible();
  });

  it("「メールアドレス変更」の項目を、「パスワード変更」の項目より上に表示する", () => {
    // Given
    // When
    render(<SettingsScreen account={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    const names = within(accountSection())
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual([
      settingsText("changeEmailItem"),
      settingsText("changePasswordItem"),
    ]);
  });

  it("「メールアドレス変更」の項目は、メールアドレス変更の画面を指す", () => {
    // Given
    // When
    render(<SettingsScreen account={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    expect(
      within(accountSection()).getByRole("link", {
        name: settingsText("changeEmailItem"),
      }),
    ).toHaveAttribute("href", CHANGE_EMAIL_PATH);
  });

  it("渡した子要素を、分類「アカウント」の区画の中にだけ表示する", () => {
    // Given
    // When
    render(<SettingsScreen account={<button type="button">操作</button>} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    const region = accountSection();
    expect(within(region).getByRole("button", { name: "操作" })).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("分類の中身を渡さなければ、区画には見出しと、メールアドレス変更とパスワード変更の項目だけを表示し、ボタンはない", () => {
    // Given
    // When
    render(<SettingsScreen account={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    const region = accountSection();
    expect(within(region).getAllByRole("heading")).toHaveLength(1);
    expect(within(region).getAllByRole("link")).toHaveLength(2);
    expect(within(region).queryByRole("button")).toBeNull();
  });

  it("分類が1つなので、タブや一覧は表示しない", () => {
    // Given
    // When
    render(<SettingsScreen account={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
