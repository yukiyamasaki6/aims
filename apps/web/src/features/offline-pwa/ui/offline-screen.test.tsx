import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OfflinePage from "@/app/offline/page";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { OfflineScreen } from "./offline-screen";

const offlinePwaText = translatorFor("offlinePwa");

describe("OfflineScreen", () => {
  it("オフラインであることと、接続を確認する案内を表示する", () => {
    // Given
    // When
    render(<OfflineScreen />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("heading", { name: offlinePwaText("offlineTitle") }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(offlinePwaText("offlineDescription")),
    ).toBeInTheDocument();
  });

  it("AIMSロゴのリンクを表示する", () => {
    // Given
    // When
    render(<OfflineScreen />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getByRole("link", { name: "AIMS" })).toBeInTheDocument();
  });

  it("/offlineのページが、オフラインであることを表示する", () => {
    // Given
    // When
    render(<OfflinePage />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("heading", { name: offlinePwaText("offlineTitle") }),
    ).toBeInTheDocument();
  });
});
