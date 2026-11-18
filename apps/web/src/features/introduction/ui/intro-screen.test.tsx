import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { IntroScreen } from "./intro-screen";

describe("IntroScreen", () => {
  it("紹介画面の各項目は、順に2桁の番号(01から)が付き、番号に対応する見出しと本文を持つ", () => {
    // Given

    // When
    render(<IntroScreen />, { wrapper: IntlTestProvider });

    // Then
    const cards = screen.getAllByRole("article");
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((card, index) => {
      const scope = within(card);
      expect(
        scope.getByText(String(index + 1).padStart(2, "0")),
      ).toBeInTheDocument();
      expect(
        scope.getByRole("heading", { level: 2 }),
      ).not.toBeEmptyDOMElement();
      expect(card.querySelectorAll("p").length).toBeGreaterThan(1);
    });
  });
});
