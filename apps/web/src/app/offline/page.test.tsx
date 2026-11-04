import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import OfflinePage from "./page";

const offlinePwaText = translatorFor("offlinePwa");

describe("OfflinePage", () => {
  it("オフラインであることを表示する", () => {
    // Given
    // When
    render(<OfflinePage />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("heading", { name: offlinePwaText("offlineTitle") }),
    ).toBeInTheDocument();
  });

  it("AIMSロゴのリンクを表示する", () => {
    // Given
    // When
    render(<OfflinePage />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getByRole("link", { name: "AIMS" })).toBeInTheDocument();
  });
});
