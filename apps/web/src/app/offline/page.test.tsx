import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import OfflinePage from "./page";

describe("OfflinePage", () => {
  it("オフラインであることを表示する", () => {
    // Given
    // When
    render(<OfflinePage />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("heading", { name: "オフラインです" }),
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
