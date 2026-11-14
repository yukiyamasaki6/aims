import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { SettingsScreen } from "./settings-screen";

const settingsText = translatorFor("settings");

function accountSection() {
  return screen.getByRole("region", { name: settingsText("accountTitle") });
}

function diagnosticsSection() {
  return screen.getByRole("region", { name: settingsText("diagnosticsTitle") });
}

describe("SettingsScreen", () => {
  it("見出し「設定」と、分類「アカウント」の見出しを表示する", () => {
    // Given
    // When
    render(<SettingsScreen account={null} diagnostics={null} />, {
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
  });

  it("渡した子要素を、分類「アカウント」の区画の中にだけ表示する", () => {
    // Given
    // When
    render(
      <SettingsScreen
        account={<button type="button">操作</button>}
        diagnostics={null}
      />,
      {
        wrapper: IntlTestProvider,
      },
    );

    // Then
    const region = accountSection();
    expect(within(region).getByRole("button", { name: "操作" })).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("分類の中身を渡さなければ、区画には見出しだけを表示する", () => {
    // Given
    // When
    render(<SettingsScreen account={null} diagnostics={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    const region = accountSection();
    expect(within(region).getAllByRole("heading")).toHaveLength(1);
    expect(within(region).queryByRole("button")).toBeNull();
  });

  it("分類が2つでも、タブや一覧は表示しない", () => {
    // Given
    // When
    render(<SettingsScreen account={null} diagnostics={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("見出し「診断」の区画を、「アカウント」の区画の後に表示する", () => {
    // Given
    // When
    render(<SettingsScreen account={null} diagnostics={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      settingsText("accountTitle"),
      settingsText("diagnosticsTitle"),
    ]);
    expect(diagnosticsSection()).toBeInTheDocument();
  });

  it("渡したdiagnosticsを、「診断」の区画の中にだけ表示する", () => {
    // Given
    // When
    render(
      <SettingsScreen
        account={null}
        diagnostics={<button type="button">切り替え</button>}
      />,
      { wrapper: IntlTestProvider },
    );

    // Then
    expect(
      within(diagnosticsSection()).getByRole("button", { name: "切り替え" }),
    ).toBeInTheDocument();
    expect(within(accountSection()).queryByRole("button")).toBeNull();
  });

  it("diagnosticsを渡さなければ、「診断」の区画には見出しだけを表示する", () => {
    // Given
    // When
    render(<SettingsScreen account={null} diagnostics={null} />, {
      wrapper: IntlTestProvider,
    });

    // Then
    const region = diagnosticsSection();
    expect(within(region).getAllByRole("heading")).toHaveLength(1);
    expect(within(region).queryByRole("button")).toBeNull();
  });
});
